'use client';

import { useEffect, useRef } from 'react';
import { toPng } from 'html-to-image';

type RenderSize = { id: string; viewW: number; viewH: number; scale: number };
type RenderArgs = { template: string; size: RenderSize; data: Record<string, unknown> };

declare global {
  interface Window {
    renderPosterStudioPng?: (args: RenderArgs) => Promise<Uint8Array>;
    setData?: (data: Record<string, unknown>) => void;
  }
}

// 等模板真正画完：字体就绪 + 所有图片加载 + 两帧 rAF（布局/滤镜落定）
async function waitForPaint(doc: Document) {
  await doc.fonts?.ready;
  await Promise.all(
    Array.from(doc.images).map((img) =>
      img.complete
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            img.onload = img.onerror = () => resolve();
          })
    )
  );
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  );
}

async function dataUrlToBytes(dataUrl: string) {
  const res = await fetch(dataUrl);
  return new Uint8Array(await res.arrayBuffer());
}

export function StudioShell() {
  const surfaceRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    // studio iframe 里的 app.js 检测到该函数存在时走浏览器本地截图，
    // 不再请求旧 Express 版的 /api/render
    window.renderPosterStudioPng = async ({ template, size, data }) => {
      const iframe = surfaceRef.current;
      if (!iframe) throw new Error('导出画布尚未就绪');

      iframe.width = String(size.viewW);
      iframe.height = String(size.viewH);
      iframe.style.width = `${size.viewW}px`;
      iframe.style.height = `${size.viewH}px`;

      const loaded = new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error('模板加载超时')), 15000);
        iframe.onload = () => {
          window.clearTimeout(timer);
          resolve();
        };
        iframe.onerror = () => {
          window.clearTimeout(timer);
          reject(new Error('模板加载失败'));
        };
      });
      iframe.src = `/src/templates/${template}/poster.html?render=${Date.now()}`;
      await loaded;

      const win = iframe.contentWindow as (Window & typeof globalThis) | null;
      const doc = iframe.contentDocument;
      if (!doc || typeof win?.setData !== 'function') {
        throw new Error('模板没有提供 setData 渲染接口');
      }

      win.setData({ ...data, _size: size.id });
      await waitForPaint(doc);

      const dataUrl = await toPng(doc.body, {
        width: size.viewW,
        height: size.viewH,
        pixelRatio: size.scale,
        cacheBust: true,
        skipAutoScale: true,
      });
      return dataUrlToBytes(dataUrl);
    };

    return () => {
      delete window.renderPosterStudioPng;
    };
  }, []);

  return (
    <>
      <iframe className="studio-shell" src="/studio/index.html" title="Poster Studio" />
      <iframe ref={surfaceRef} className="render-surface" title="海报导出画布" aria-hidden="true" />
    </>
  );
}
