import zh from '@/i18n/zh.json';
import en from '@/i18n/en.json';

type NestedKeyOf<T> = T extends object
  ? { [K in keyof T]: K extends string
      ? T[K] extends object ? `${K}.${NestedKeyOf<T[K]>}` : K
      : never
    }[keyof T]
  : never;

type TranslationKey = NestedKeyOf<typeof zh>;

const messages: Record<string, Record<string, unknown>> = { zh, en };
let currentLocale = 'zh';

export function setLocale(locale: string) {
  currentLocale = locale;
}

export function getLocale(): string {
  return currentLocale;
}

function getNested(obj: Record<string, any>, path: string): string | undefined {
  const keys = path.split('.');
  let current: any = obj;
  for (const k of keys) {
    if (current == null || typeof current !== 'object') return undefined;
    current = current[k];
  }
  return typeof current === 'string' ? current : undefined;
}

export function t(key: TranslationKey | string, params?: Record<string, string | number>): string {
  const msg = messages[currentLocale] || messages.zh;
  let text = getNested(msg as Record<string, any>, key as string);
  if (text == null) return key as string;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(`{${k}}`, String(v));
    }
  }
  return text;
}
