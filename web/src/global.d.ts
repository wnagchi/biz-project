export {};

declare global {
  interface Window {
    BizMarkdown: { render(content?: string): HTMLElement };
    BizRulesUI?: { load(): Promise<void>; render(): Node | Node[] | null | undefined };
    BizPlatformUI: {
      api: (route: string, body?: unknown) => Promise<unknown>;
      work: (action: () => Promise<void>) => Promise<void>;
      render: () => void;
      el: (tag: string, props?: Record<string, unknown>, ...children: unknown[]) => HTMLElement;
      button: (label: string, action: () => void, glyph?: string, kind?: string) => HTMLButtonElement;
      tool: (label: string, action: () => void, glyph: string) => HTMLButtonElement;
      modal: (title: string, body: unknown, actions?: HTMLElement[]) => HTMLDialogElement;
      field: (label: string, control: HTMLElement) => HTMLElement;
      documentView: (content?: string) => HTMLElement;
      canLeave: () => boolean;
      rulesUnavailable: string;
    };
  }
}
