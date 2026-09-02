import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const baseUrl = 'http://localhost:3000/';
const resultsDir = 'test-results';
await mkdir(resultsDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: chromePath,
  headless: true,
  args: [
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    '--use-angle=swiftshader-webgl',
    '--enable-unsafe-swiftshader',
  ],
});

const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const runtimeErrors = [];
const responseErrors = [];
page.on('pageerror', (error) => runtimeErrors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:')) runtimeErrors.push(message.text());
});
page.on('response', (response) => {
  if (response.status() >= 400) responseErrors.push(`${response.status()} ${response.url()}`);
});

async function canvasStats() {
  return page.locator('.baton-stage canvas').evaluate((canvas) => {
    const source = canvas;
    const copy = document.createElement('canvas');
    copy.width = source.width;
    copy.height = source.height;
    const context2d = copy.getContext('2d', { willReadFrequently: true });
    if (!context2d) return { width: source.width, height: source.height, visiblePixels: 0, luminanceRange: 0 };
    context2d.drawImage(source, 0, 0);
    const pixels = context2d.getImageData(0, 0, copy.width, copy.height).data;
    let visiblePixels = 0;
    let min = 255;
    let max = 0;
    for (let index = 0; index < pixels.length; index += 16) {
      const luminance = (pixels[index] + pixels[index + 1] + pixels[index + 2]) / 3;
      if (pixels[index + 3] > 0 && luminance > 3) visiblePixels += 1;
      min = Math.min(min, luminance);
      max = Math.max(max, luminance);
    }
    return { width: source.width, height: source.height, visiblePixels, luminanceRange: max - min };
  });
}

try {
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.locator('.baton-stage canvas').waitFor({ state: 'visible' });
  await page.waitForTimeout(700);
  const desktopCanvas = await canvasStats();
  if (desktopCanvas.width < 300 || desktopCanvas.height < 250 || desktopCanvas.visiblePixels < 50 || desktopCanvas.luminanceRange < 20) {
    throw new Error(`Desktop WebGL canvas is blank or undersized: ${JSON.stringify(desktopCanvas)}`);
  }

  const stage = await page.locator('.baton-stage').boundingBox();
  if (!stage) throw new Error('Baton stage is not visible');
  await page.mouse.move(stage.x + stage.width * 0.5, stage.y + stage.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(stage.x + stage.width * 0.78, stage.y + stage.height * 0.3, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  const xReadout = await page.locator('.metric-cell strong').first().textContent();
  if (!xReadout || Math.abs(Number(xReadout)) < 0.1) throw new Error(`Simulation X did not move: ${xReadout}`);

  await page.getByRole('button', { name: '재생' }).click();
  await page.waitForTimeout(250);
  if (await page.getByRole('button', { name: '일시정지' }).isDisabled()) throw new Error('Audio playback did not enter playing state');

  await page.getByRole('button', { name: '카메라 켜기' }).click();
  await page.waitForTimeout(1200);
  const cameraState = await page.locator('.status-list dd').first().textContent();
  if (!cameraState?.includes('준비')) throw new Error(`Camera did not reach ready state: ${cameraState}`);

  await page.screenshot({ path: `${resultsDir}/desktop.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('.baton-stage canvas').waitFor({ state: 'visible' });
  await page.waitForTimeout(600);
  const mobileCanvas = await canvasStats();
  if (mobileCanvas.width < 250 || mobileCanvas.height < 250 || mobileCanvas.visiblePixels < 40 || mobileCanvas.luminanceRange < 20) {
    throw new Error(`Mobile WebGL canvas is blank or undersized: ${JSON.stringify(mobileCanvas)}`);
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflow > 1) throw new Error(`Mobile layout overflows horizontally by ${overflow}px`);
  await page.screenshot({ path: `${resultsDir}/mobile.png`, fullPage: true });

  if (runtimeErrors.length || responseErrors.length) {
    throw new Error(`Runtime errors: ${[...runtimeErrors, ...responseErrors].join(' | ')}`);
  }
  console.log(JSON.stringify({ desktopCanvas, mobileCanvas, xReadout, cameraState, runtimeErrors, responseErrors }, null, 2));
} finally {
  await browser.close();
}
