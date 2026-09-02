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
await page.addInitScript(() => {
  const cameraCanvas = document.createElement('canvas');
  cameraCanvas.width = 640;
  cameraCanvas.height = 480;
  const cameraContext = cameraCanvas.getContext('2d');
  const rowPatterns = [
    [1, 0, 0, 0, 0],
    [1, 0, 1, 1, 1],
    [0, 1, 0, 0, 1],
    [0, 1, 1, 1, 0],
  ];

  function markerMatrix(id) {
    const matrix = Array.from({ length: 7 }, () => Array(7).fill(0));
    for (let row = 0; row < 5; row += 1) {
      const first = (id >> (9 - row * 2)) & 1;
      const second = (id >> (8 - row * 2)) & 1;
      matrix[row + 1].splice(1, 5, ...rowPatterns[(first << 1) | second]);
    }
    return matrix;
  }

  function drawMarker(id, x, y, cell = 12) {
    cameraContext.fillStyle = '#ffffff';
    cameraContext.fillRect(x, y, cell * 9, cell * 9);
    cameraContext.fillStyle = '#000000';
    cameraContext.fillRect(x + cell, y + cell, cell * 7, cell * 7);
    const matrix = markerMatrix(id);
    matrix.forEach((row, markerY) => row.forEach((value, markerX) => {
      if (!value) return;
      cameraContext.fillStyle = '#ffffff';
      cameraContext.fillRect(x + (markerX + 1) * cell, y + (markerY + 1) * cell, cell, cell);
    }));
  }

  function drawCameraFrame(now = 0) {
    const offset = Math.sin(now / 500) * 34;
    cameraContext.fillStyle = '#d8dde0';
    cameraContext.fillRect(0, 0, cameraCanvas.width, cameraCanvas.height);
    drawMarker(0, 125 + offset, 275);
    drawMarker(1, 365 + offset, 275);
    drawMarker(2, 245 + offset, 115);
    requestAnimationFrame(drawCameraFrame);
  }
  drawCameraFrame();

  navigator.mediaDevices.getUserMedia = async () => cameraCanvas.captureStream(30);
});
const runtimeErrors = [];
const responseErrors = [];
page.on('pageerror', (error) => runtimeErrors.push(error.message));
page.on('console', (message) => {
  const messageText = message.text();
  const informationalMediaPipeLog = messageText.includes('Created TensorFlow Lite XNNPACK delegate for CPU');
  if (message.type() === 'error' && !messageText.startsWith('Failed to load resource:') && !informationalMediaPipeLog) {
    runtimeErrors.push(messageText);
  }
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

async function cameraOverlayStats() {
  return page.locator('.camera-preview canvas').evaluate((canvas) => {
    const context2d = canvas.getContext('2d', { willReadFrequently: true });
    if (!context2d) return { width: canvas.width, height: canvas.height, swordPixels: 0 };
    const pixels = context2d.getImageData(0, 0, canvas.width, canvas.height).data;
    let swordPixels = 0;
    for (let y = 0; y < Math.min(105, canvas.height); y += 1) {
      for (let x = Math.floor(canvas.width * 0.32); x < Math.floor(canvas.width * 0.68); x += 1) {
        const offset = (y * canvas.width + x) * 4;
        const [red, green, blue] = [pixels[offset], pixels[offset + 1], pixels[offset + 2]];
        if (blue > 190 && green > 145 && red < 190) swordPixels += 1;
      }
    }
    return { width: canvas.width, height: canvas.height, swordPixels };
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
  await page.getByRole('button', { name: '사각파' }).click();
  await page.waitForTimeout(180);
  const waveform = await page.locator('.waveform-buttons button.active').textContent();
  if (!waveform?.includes('사각파')) throw new Error(`Waveform selection did not activate: ${waveform}`);
  const baseTone = await page.locator('.track-header b').first().textContent();
  if (!baseTone?.includes('440')) throw new Error(`Base synth tone is not 440 Hz: ${baseTone}`);
  const tutorialSteps = await page.locator('.motion-tutorial li').count();
  if (tutorialSteps !== 6) throw new Error(`Motion tutorial is incomplete: ${tutorialSteps} steps`);

  await page.getByRole('button', { name: '카메라 켜기' }).click();
  await page.waitForTimeout(800);
  const cameraState = await page.locator('.status-list dd').first().textContent();
  if (!cameraState?.includes('준비')) throw new Error(`Camera did not reach ready state: ${cameraState}`);

  await page.waitForFunction(
    () => document.querySelectorAll('.status-list dd')[1]?.textContent?.includes('손 미검출'),
    undefined,
    { timeout: 20_000 },
  );
  const handModelState = await page.locator('.status-list dd').nth(1).textContent();
  const mediaPipeAssets = await page.evaluate(() => performance.getEntriesByType('resource')
    .map((entry) => entry.name)
    .filter((name) => name.includes('/mediapipe/'))
    .map((name) => new URL(name).pathname));
  await page.getByRole('button', { name: '마커 추적' }).click();
  await page.waitForTimeout(1600);

  const markerReadout = await page.locator('.status-list dd').nth(1).textContent();
  if (!markerReadout?.includes('0') || !markerReadout.includes('1') || !markerReadout.includes('2')) {
    throw new Error(`Virtual camera markers were not detected: ${markerReadout}`);
  }
  const cameraOverlay = await cameraOverlayStats();
  if (cameraOverlay.swordPixels < 120) throw new Error(`Camera sword overlay is missing: ${JSON.stringify(cameraOverlay)}`);

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
  console.log(JSON.stringify({ desktopCanvas, mobileCanvas, xReadout, waveform, baseTone, tutorialSteps, cameraState, handModelState, mediaPipeAssets, markerReadout, cameraOverlay, runtimeErrors, responseErrors }, null, 2));
} finally {
  await browser.close();
}
