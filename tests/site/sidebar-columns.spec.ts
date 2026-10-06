import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

/**
 * 侧栏栏位契约 + 站内导航回归。
 *
 * - 三列（dual）未真正生效时 `column` 标签失效，声明为 `column: "secondary"`
 *   的 widget 必须落回主栏，不能被静默丢弃（`toc` 就是这类 widget，它同时是
 *   Swup 的 `#toc` 替换容器）。
 * - `#toc` 缺失会让 Swup 以 `Container mismatch, aborting` 中止访问：站内点击
 *   退化为整页刷新，并把 `is-changing/is-animating/is-rendering` 留在 `<html>`
 *   （`transition.css` 的 `opacity: 0`），浏览器后退经 bfcache 恢复该文档时
 *   表现为界面卡死。
 */
const POST_CARD = '#swup-container a[href^="/posts/"]';

declare global {
	interface Window {
		__navMarker?: string;
	}
}

/** Swup 一次访问结束后 `<html>` 上的过渡类都被清理 */
async function waitForVisitSettled(page: Page) {
	await page.waitForFunction(
		() => !document.documentElement.classList.contains("is-changing"),
	);
}

test.describe("Sidebar columns", () => {
	test("secondary widgets fall back to the rendered sidebar column", async ({
		page,
	}) => {
		// 用站内导航进入一篇文章，避免依赖主题自带的内容夹具路径
		await page.goto("/", { waitUntil: "domcontentloaded" });
		await page.waitForFunction(() => Boolean(window.swup?.navigate));
		await page.locator(POST_CARD).first().click();
		await page.waitForFunction(() => location.pathname.startsWith("/posts/"));
		await waitForVisitSettled(page);

		// 每个页面都必须恰好有一个 Swup 的 `#toc` 替换容器
		await expect(page.locator("#toc")).toHaveCount(1);

		// 副栏只在三列生效时渲染；没有副栏时 secondary widget 必须落在主栏
		const hasSecondary = (await page.locator("#sidebar-secondary").count()) > 0;
		const owner = hasSecondary ? "#sidebar-secondary" : "#sidebar";
		await expect(page.locator(`${owner} #toc`)).toHaveCount(1);
		// 未生效侧的栏位不得重复渲染同一个 widget
		await expect(page.locator(`${owner} .sidebar-toc`)).toHaveCount(1);
		// 文章页的目录卡片要真的可见（pages 过滤不能把它隐藏）
		await expect(page.locator(`${owner} .sidebar-toc`)).toBeVisible();
	});

	test("navigation stays client-side and history back restores an interactive page", async ({
		page,
	}) => {
		await page.goto("/", { waitUntil: "domcontentloaded" });
		await page.waitForFunction(() => Boolean(window.swup?.navigate));

		// 非文章页同样保留容器（只是包装层 hidden），否则切页即容器不匹配
		await expect(page.locator("#toc")).toHaveCount(1);

		await page.evaluate(() => {
			window.__navMarker = "alive";
		});

		await page.locator(POST_CARD).first().click();
		await page.waitForFunction(() => location.pathname.startsWith("/posts/"));
		await waitForVisitSettled(page);

		// 整页刷新会清空 window 上的标记
		expect(await page.evaluate(() => window.__navMarker)).toBe("alive");
		await expect(page.locator("html")).not.toHaveClass(/is-animating/);
		await expect(page.locator("#swup-container")).toHaveCSS("opacity", "1");

		await page.goBack();
		await page.waitForFunction(() => location.pathname === "/");
		await waitForVisitSettled(page);

		expect(await page.evaluate(() => window.__navMarker)).toBe("alive");
		await expect(page.locator("html")).not.toHaveClass(/is-animating/);
		await expect(page.locator("#swup-container")).toHaveCSS("opacity", "1");
	});
});
