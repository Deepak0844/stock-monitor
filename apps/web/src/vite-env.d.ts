/// <reference types="vite/client" />

// noVNC ships plain JavaScript with no types. This is the part of it the app uses.
declare module "@novnc/novnc" {
  export default class RFB extends EventTarget {
    constructor(target: HTMLElement, urlOrChannel: string | WebSocket, options?: { credentials?: { password?: string } });
    scaleViewport: boolean;
    disconnect(): void;
    focus(): void;
    clipboardPasteFrom(text: string): void;
  }
}
