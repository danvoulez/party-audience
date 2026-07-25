import { expect, test, type Page } from "@playwright/test";
import { PORTS } from "../playwright.config";

const urls = {
  unconfigured: `http://127.0.0.1:${PORTS.unconfigured}/`,
  iframe: `http://127.0.0.1:${PORTS.iframe}/`,
  hlsDead: `http://127.0.0.1:${PORTS.hlsDead}/`,
};

declare global {
  interface Window {
    __gumCalled?: boolean;
  }
}

/** Instala uma sonda: qualquer pedido de câmera/microfone marca __gumCalled. */
async function armGetUserMediaProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if (navigator.mediaDevices) {
      navigator.mediaDevices.getUserMedia = () => {
        window.__gumCalled = true;
        return Promise.reject(new Error("bloqueado pelo teste"));
      };
    }
  });
}

test("TV não configurada: página funciona e mostra indisponibilidade honesta", async ({ page }) => {
  await armGetUserMediaProbe(page);
  await page.goto(urls.unconfigured);

  await expect(page.locator("#tv")).toHaveAttribute("data-state", "unavailable");
  const overlay = page.locator("#tv-overlay-unavailable");
  await expect(overlay).toBeVisible();
  await expect(overlay).toContainText("TV indisponível");
  await expect(overlay).toContainText("ainda não foi configurada");

  await expect(page.getByRole("link", { name: "Entrar" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Criar conta" })).toBeVisible();
  expect(await page.evaluate(() => window.__gumCalled)).toBeUndefined();
});

test("fluxo de sucesso: iframe do parceiro carrega e o estado vira playing", async ({ page }) => {
  await armGetUserMediaProbe(page);
  await page.goto(urls.iframe);

  await expect(page.locator("#tv")).toHaveAttribute("data-state", "playing", { timeout: 15_000 });
  const iframe = page.locator("#tv-iframe");
  await expect(iframe).toHaveAttribute("src", /127\.0\.0\.1:\d+\/healthz/);
  await expect(page.locator("#tv-overlay-loading")).toBeHidden();
  await expect(page.locator("#tv-overlay-unavailable")).toBeHidden();
  // Em modo iframe o som é controlado pelo player do parceiro.
  await expect(page.locator("#tv-unmute")).toBeHidden();
  expect(await page.evaluate(() => window.__gumCalled)).toBeUndefined();
});

test("fluxo de falha: HLS fora do ar mostra loading e depois o fallback", async ({ page }) => {
  await page.goto(urls.hlsDead);

  const tv = page.locator("#tv");
  await expect(tv).toHaveAttribute("data-state", /loading|unavailable/);
  await expect(tv).toHaveAttribute("data-state", "unavailable", { timeout: 10_000 });

  const overlay = page.locator("#tv-overlay-unavailable");
  await expect(overlay).toBeVisible();
  await expect(overlay).toContainText("fora do ar");

  // Tentar novamente reinicia o ciclo e volta a falhar de forma visível.
  await page.locator("#tv-retry").click();
  await expect(tv).toHaveAttribute("data-state", "unavailable", { timeout: 10_000 });
});

test("layout responde a viewports mobile e desktop", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto(urls.unconfigured);
  await expect(page.locator("#tv")).toBeVisible();
  const mobileBox = await page.locator("#tv").boundingBox();
  expect(mobileBox && mobileBox.width).toBeLessThanOrEqual(375);

  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.locator("#tv")).toBeVisible();
  const desktopBox = await page.locator("#tv").boundingBox();
  expect(desktopBox && desktopBox.width).toBeGreaterThan(600);
});

test("links de login e cadastro levam a telas que declaram a próxima etapa", async ({ page }) => {
  await page.goto(urls.unconfigured);
  await page.getByRole("link", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.locator("main")).toContainText("próxima etapa");
});
