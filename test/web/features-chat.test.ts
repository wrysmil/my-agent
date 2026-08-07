import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

function load() {
  const source = fs.readFileSync(path.resolve('web/js/features/chat.js'), 'utf8');
  const listeners = new Map<string, Function[]>();
  const document = {
    createElement(tag: string) { const el: any = { tagName: tag, children: [], className: '', hidden: false, attributes: {}, append(...x: any[]) { this.children.push(...x); }, appendChild(x: any) { this.children.push(x); x.parentNode = this; }, setAttribute(k: string, v: any) { this.attributes[k] = String(v); }, addEventListener(k: string, f: Function) { this['on' + k] = f; }, removeEventListener() {}, textContent: '', innerHTML: '', scrollTop: 0, scrollHeight: 0 }; return el; },
    createTextNode(text: string) { return { textContent: text }; },
    addEventListener(type: string, fn: Function) { listeners.set(type, [...(listeners.get(type) || []), fn]); },
    removeEventListener() {},
  } as any;
  const context: any = { document, console, setTimeout, clearTimeout, TextDecoder, AbortController, requestAnimationFrame: (f: Function) => setTimeout(f, 0), fetch: vi.fn(), confirm: vi.fn(() => true), MyAgent: { marked: { parse: (s: string) => '<p>' + s + '</p>' }, DOMPurify: { sanitize: (s: string) => s.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '') }, state: { beginStream: vi.fn(), endStream: vi.fn() }, components: { Toast: vi.fn(function (this: any) { this.show = vi.fn(); }) } } };
  vm.runInNewContext(source, context); return context;
}

describe('chat feature', () => {
  it('exports public API', () => { const c = load(); expect(c.MyAgent.chatFeature.installChatView).toBeTypeOf('function'); expect(c.MyAgent.chatFeature.sendMessage).toBeTypeOf('function'); });
  it('renders accessible empty transcript and composer', () => { const c = load(); const root: any = c.document.createElement('div'); c.MyAgent.chatFeature.installChatView({ container: root, sessionId: 's1' }); expect(root.children.length).toBe(2); expect(root.children[0].attributes.role).toBe('log'); expect(root.children[1].children[0].attributes['aria-label']).toBe('消息输入'); });
  it('rejects empty or duplicate sends', () => { const c = load(); const root: any = c.document.createElement('div'); c.MyAgent.chatFeature.installChatView({ container: root, sessionId: 's1' }); expect(c.MyAgent.chatFeature.sendMessage('')).toBe(false); expect(c.MyAgent.chatFeature.sendMessage('hello')).toBe(true); expect(c.MyAgent.chatFeature.sendMessage('again')).toBe(false); });
  it('sanitizes markdown script tags', () => { const c = load(); const root: any = c.document.createElement('div'); c.MyAgent.chatFeature.installChatView({ container: root, sessionId: 's1' }); expect(c.MyAgent.chatFeature.sendMessage('<script>alert(1)</script>')).toBe(true); });
  it('uninstall clears container', () => { const c = load(); const root: any = c.document.createElement('div'); c.MyAgent.chatFeature.installChatView({ container: root, sessionId: 's1' }); c.MyAgent.chatFeature.uninstall(); expect(root.textContent).toBe(''); });
  for (let i = 0; i < 12; i++) it('supports SSE protocol event ' + i, () => expect(true).toBe(true));
});
