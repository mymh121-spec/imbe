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

  function drawCameraFrame(now = 0) {
    const offset = Math.sin(now / 500) * 120;
    cameraContext.fillStyle = '#18242a';
    cameraContext.fillRect(0, 0, cameraCanvas.width, cameraCanvas.height);
    cameraContext.fillStyle = '#6cc9ff';
    cameraContext.fillRect(cameraCanvas.width / 2 + offset - 10, cameraCanvas.height / 2 - 10, 20, 20);
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

  await page.mouse.move(stage.x + stage.width * 0.5, stage.y + stage.height * 0.25);
  await page.mouse.down();
  for (let beat = 0; beat < 4; beat += 1) {
    await page.mouse.move(stage.x + stage.width * 0.5, stage.y + stage.height * 0.25);
    await page.waitForTimeout(80);
    await page.mouse.move(stage.x + stage.width * 0.5, stage.y + stage.height * 0.5);
    await page.waitForTimeout(80);
    await page.mouse.move(stage.x + stage.width * 0.5, stage.y + stage.height * 0.76);
    await page.waitForTimeout(100);
    await page.mouse.move(stage.x + stage.width * 0.5, stage.y + stage.height * 0.5);
    await page.waitForTimeout(80);
    await page.mouse.move(stage.x + stage.width * 0.5, stage.y + stage.height * 0.25);
    await page.waitForTimeout(120);
  }
  await page.mouse.up();
  const beatReadout = await page.locator('.beat-badge').textContent();
  if (!beatReadout || beatReadout.includes('BEAT –') || beatReadout.includes('--- BPM')) {
    throw new Error(`Conducting beat was not detected: ${beatReadout}`);
  }

  await page.getByRole('tab', { name: '학습' }).click();
  await page.waitForFunction(
    () => {
      const status = document.querySelector('.model-status-list dd')?.textContent ?? '';
      return status && !status.includes('준비 중');
    },
    undefined,
    { timeout: 20_000 },
  );
  const gestureModelState = await page.locator('.model-status-list dd').first().textContent();
  if (!gestureModelState?.includes('모델 없음') && !gestureModelState?.includes('모델 준비됨')) {
    throw new Error(`Gesture model failed to initialize: ${gestureModelState}`);
  }
  const sampleButtons = page.locator('.gesture-sample-grid button');
  const sampleButtonCount = await sampleButtons.count();
  if (sampleButtonCount !== 9) throw new Error(`Gesture training labels are incomplete: ${sampleButtonCount}`);
  if (!await sampleButtons.first().isDisabled()) throw new Error('Gesture capture should require a detected camera hand');
  await page.screenshot({ path: `${resultsDir}/learning.png`, fullPage: true });
  await page.getByRole('tab', { name: '입력' }).click();

  const commandSwitch = page.getByRole('switch', { name: '손 명령 사용' });
  await commandSwitch.click();
  if (!await commandSwitch.isChecked()) throw new Error('Hand command safety switch did not enable');
  const beatSyncSwitch = page.getByRole('switch', { name: '박자 동기화' });
  await beatSyncSwitch.click();
  if (!await beatSyncSwitch.isChecked()) throw new Error('Beat sync switch did not enable');
  await page.getByRole('tab', { name: '매핑' }).click();
  await page.getByLabel('박자 패턴').selectOption('3');
  const threeBeatReadout = await page.locator('.beat-badge').textContent();
  if (!threeBeatReadout?.includes('/3')) throw new Error(`Three-beat pattern did not activate: ${threeBeatReadout}`);
  await page.getByRole('tab', { name: '입력' }).click();

  await page.getByRole('button', { name: '재생' }).click();
  await page.waitForTimeout(250);
  if (await page.getByRole('button', { name: '일시정지' }).isDisabled()) throw new Error('Audio playback did not enter playing state');
  await page.getByRole('button', { name: '사각파' }).click();
  await page.waitForTimeout(180);
  const waveform = await page.locator('.waveform-buttons button.active').textContent();
  if (!waveform?.includes('사각파')) throw new Error(`Waveform selection did not activate: ${waveform}`);
  const baseTone = await page.locator('.track-header b').first().textContent();
  if (!baseTone?.includes('440')) throw new Error(`Base synth tone is not 440 Hz: ${baseTone}`);
  await page.waitForFunction(() => {
    const meter = document.querySelector('.audio-master > .meter i');
    return meter instanceof HTMLElement && Number.parseFloat(meter.style.width) > 1;
  });
  const audibleMeter = await page.locator('.audio-master > .meter i').evaluate((meter) => Number.parseFloat(meter.style.width));
  await page.getByRole('button', { name: '크레센도', exact: true }).click();
  const crescendoLevel = await page.locator('.motion-tutorial .waveform-label b').textContent();
  if (crescendoLevel !== '80%') throw new Error(`Crescendo did not raise dynamics: ${crescendoLevel}`);
  await page.getByRole('button', { name: '디크레센도', exact: true }).click();
  const decrescendoLevel = await page.locator('.motion-tutorial .waveform-label b').textContent();
  if (decrescendoLevel !== '70%') throw new Error(`Decrescendo did not lower dynamics: ${decrescendoLevel}`);

  const muteButton = page.locator('.dynamics-actions button').nth(1);
  await muteButton.click();
  await page.waitForTimeout(220);
  const muteState = await muteButton.getAttribute('aria-pressed');
  const mutedMaster = await page.locator('.master-values b').first().textContent();
  const mutedMeter = await page.locator('.audio-master > .meter i').evaluate((meter) => Number.parseFloat(meter.style.width));
  if (muteState !== 'true' || mutedMaster !== 'MUTE' || mutedMeter > 2) {
    throw new Error(`Mute did not activate: ${muteState}, ${mutedMaster}, meter ${mutedMeter}`);
  }
  await muteButton.click();
  await page.waitForFunction(() => {
    const meter = document.querySelector('.audio-master > .meter i');
    return meter instanceof HTMLElement && Number.parseFloat(meter.style.width) > 1;
  });

  await page.getByRole('button', { name: '템포 높이기' }).click();
  const tempo = await page.locator('.tutorial-adjust-row').first().locator('output').textContent();
  if (tempo !== '110 BPM') throw new Error(`Tempo did not increase: ${tempo}`);
  await page.getByRole('button', { name: '왼쪽 소리 가중치 높이기' }).click();
  const balance = await page.locator('.tutorial-adjust-row').nth(1).locator('output').textContent();
  if (balance !== 'L 20%') throw new Error(`Left balance did not increase: ${balance}`);

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
  if (!mediaPipeAssets.some((asset) => asset.endsWith('/models/hand_landmarker.task'))) {
    throw new Error(`Local MediaPipe model was not loaded: ${mediaPipeAssets.join(', ')}`);
  }

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
  console.log(JSON.stringify({ desktopCanvas, mobileCanvas, xReadout, beatReadout, threeBeatReadout, gestureModelState, sampleButtonCount, waveform, baseTone, audibleMeter, crescendoLevel, decrescendoLevel, muteState, mutedMeter, tempo, balance, cameraState, handModelState, mediaPipeAssets, runtimeErrors, responseErrors }, null, 2));
} finally {
  await browser.close();
}
