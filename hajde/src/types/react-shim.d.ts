/*
 * OFFLINE-ONLY type shim for 'react', 'react/jsx-runtime' and 'react-dom/client'.
 *
 * The sandbox this migration was done in has no @types/react, so this file declares
 * the subset of React 19's API the app uses, with the same signatures as @types/react
 * (simplified: element props are loose, events are typed). It is used only by
 * tsconfig.offline.json; tsconfig.json (the real config) excludes it.
 * Once `npm install` has put @types/react and @types/react-dom in node_modules,
 * delete this file, vendor-shim.d.ts and tsconfig.offline.json (see TYPESCRIPT.md).
 */

/** Declared as a namespace so both `import React from 'react'` and named imports work (as in @types/react). */
declare namespace React {
  // ---- core element / node types ----
  export type Key = string | number | bigint
  export interface ReactElement<P = unknown, T = unknown> { type: T; props: P; key: string | null }
  export type ReactNode =
    | ReactElement
    | string
    | number
    | bigint
    | boolean
    | null
    | undefined
    | Iterable<ReactNode>
    | Promise<ReactNode>
  export type PropsWithChildren<P = unknown> = P & { children?: ReactNode }

  export interface FunctionComponent<P = {}> {
    (props: P): ReactNode | Promise<ReactNode>
    displayName?: string
  }
  export type FC<P = {}> = FunctionComponent<P>
  export interface ComponentClass<P = {}> { new (props: P): { render(): ReactNode; props: P } }
  export type ComponentType<P = {}> = ComponentClass<P> | FunctionComponent<P>
  export type JSXElementConstructor<P> = (props: P) => ReactNode | Promise<ReactNode>
  export type ComponentProps<T> = T extends JSXElementConstructor<infer P> ? P : {}

  // ---- refs ----
  export interface RefObject<T> { current: T }
  export type RefCallback<T> = (instance: T | null) => void | (() => void)
  export type Ref<T> = RefCallback<T> | RefObject<T | null> | null

  // ---- hooks ----
  export type Dispatch<A> = (value: A) => void
  export type SetStateAction<S> = S | ((prevState: S) => S)
  export type DependencyList = readonly unknown[]
  export type EffectCallback = () => void | (() => void)

  export function useState<S>(initialState: S | (() => S)): [S, Dispatch<SetStateAction<S>>]
  export function useState<S = undefined>(): [S | undefined, Dispatch<SetStateAction<S | undefined>>]
  export function useEffect(effect: EffectCallback, deps?: DependencyList): void
  export function useLayoutEffect(effect: EffectCallback, deps?: DependencyList): void
  export function useMemo<T>(factory: () => T, deps: DependencyList): T
  export function useCallback<T extends Function>(callback: T, deps: DependencyList): T
  export function useRef<T>(initialValue: T): RefObject<T>
  export function useRef<T>(initialValue: T | null): RefObject<T | null>
  export function useRef<T>(initialValue: T | undefined): RefObject<T | undefined>

  // ---- context ----
  export interface ProviderProps<T> { value: T; children?: ReactNode }
  export interface Context<T> extends FunctionComponent<ProviderProps<T>> {
    Provider: FunctionComponent<ProviderProps<T>>
    displayName?: string
  }
  export function createContext<T>(defaultValue: T): Context<T>
  export function useContext<T>(context: Context<T>): T

  // ---- components ----
  export const Fragment: FunctionComponent<{ children?: ReactNode }>
  export const StrictMode: FunctionComponent<{ children?: ReactNode }>
  export interface SuspenseProps { children?: ReactNode; fallback?: ReactNode }
  export const Suspense: FunctionComponent<SuspenseProps>
  export type LazyExoticComponent<T extends ComponentType<any>> = T
  export function lazy<T extends ComponentType<any>>(load: () => Promise<{ default: T }>): LazyExoticComponent<T>
  export function memo<P extends object>(component: FunctionComponent<P>, areEqual?: (prev: Readonly<P>, next: Readonly<P>) => boolean): FunctionComponent<P>

  // ---- events (same shape as @types/react's synthetic events) ----
  export interface SyntheticEvent<T = Element, E = Event> {
    nativeEvent: E
    currentTarget: EventTarget & T
    target: EventTarget
    bubbles: boolean
    cancelable: boolean
    defaultPrevented: boolean
    eventPhase: number
    isTrusted: boolean
    timeStamp: number
    type: string
    preventDefault(): void
    stopPropagation(): void
    isDefaultPrevented(): boolean
    isPropagationStopped(): boolean
    persist(): void
  }
  export interface ChangeEvent<T = Element> extends SyntheticEvent<T> { target: EventTarget & T }
  export interface FormEvent<T = Element> extends SyntheticEvent<T> {}
  export interface FocusEvent<T = Element> extends SyntheticEvent<T, globalThis.FocusEvent> { relatedTarget: (EventTarget & Element) | null }
  export interface UIEvent<T = Element, E = Event> extends SyntheticEvent<T, E> {}
  export interface MouseEvent<T = Element, E = globalThis.MouseEvent> extends UIEvent<T, E> {
    altKey: boolean; button: number; buttons: number; clientX: number; clientY: number
    ctrlKey: boolean; metaKey: boolean; pageX: number; pageY: number; shiftKey: boolean
  }
  export interface KeyboardEvent<T = Element> extends UIEvent<T, globalThis.KeyboardEvent> {
    altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean
    code: string; key: string; repeat: boolean
  }
  export interface PointerEvent<T = Element> extends MouseEvent<T, globalThis.PointerEvent> { pointerId: number; pointerType: string }
  export interface ClipboardEvent<T = Element> extends SyntheticEvent<T, globalThis.ClipboardEvent> { clipboardData: DataTransfer }
  export interface DragEvent<T = Element> extends MouseEvent<T, globalThis.DragEvent> { dataTransfer: DataTransfer }
  export interface TouchEvent<T = Element> extends UIEvent<T, globalThis.TouchEvent> {}
  export interface WheelEvent<T = Element> extends MouseEvent<T, globalThis.WheelEvent> { deltaX: number; deltaY: number }
  export type EventHandler<E> = (event: E) => void

  // ---- element props (loose: unknown attributes are accepted, event handlers are typed) ----
  export type CSSProperties = { [property: string]: string | number | undefined }
  export interface DOMAttributes<T> {
    children?: ReactNode
    dangerouslySetInnerHTML?: { __html: string | TrustedHTML }
    onClick?: EventHandler<MouseEvent<T>>
    onDoubleClick?: EventHandler<MouseEvent<T>>
    onMouseDown?: EventHandler<MouseEvent<T>>
    onMouseUp?: EventHandler<MouseEvent<T>>
    onMouseEnter?: EventHandler<MouseEvent<T>>
    onMouseLeave?: EventHandler<MouseEvent<T>>
    onPointerDown?: EventHandler<PointerEvent<T>>
    onPointerUp?: EventHandler<PointerEvent<T>>
    onTouchStart?: EventHandler<TouchEvent<T>>
    onTouchEnd?: EventHandler<TouchEvent<T>>
    onKeyDown?: EventHandler<KeyboardEvent<T>>
    onKeyUp?: EventHandler<KeyboardEvent<T>>
    onFocus?: EventHandler<FocusEvent<T>>
    onBlur?: EventHandler<FocusEvent<T>>
    onChange?: EventHandler<ChangeEvent<T>>
    onInput?: EventHandler<FormEvent<T>>
    onSubmit?: EventHandler<FormEvent<T>>
    onToggle?: EventHandler<SyntheticEvent<T>>
    onScroll?: EventHandler<UIEvent<T>>
    onWheel?: EventHandler<WheelEvent<T>>
    onPaste?: EventHandler<ClipboardEvent<T>>
    onDragOver?: EventHandler<DragEvent<T>>
    onDrop?: EventHandler<DragEvent<T>>
    onLoad?: EventHandler<SyntheticEvent<T>>
    onError?: EventHandler<SyntheticEvent<T>>
  }
  export interface HTMLAttributes<T> extends DOMAttributes<T> {
    key?: Key | null
    ref?: Ref<T>
    className?: string
    id?: string
    style?: CSSProperties
    title?: string
    role?: string
    tabIndex?: number
    hidden?: boolean
  }
  export interface InputHTMLAttributes<T> extends HTMLAttributes<T> {
    type?: string
    value?: string | readonly string[] | number
    defaultValue?: string | readonly string[] | number
    checked?: boolean
    disabled?: boolean
    placeholder?: string
    name?: string
    required?: boolean
    readOnly?: boolean
    autoFocus?: boolean
    autoComplete?: string
    autoCapitalize?: string
    autoCorrect?: string
    spellCheck?: boolean | 'true' | 'false'
    inputMode?: 'none' | 'text' | 'tel' | 'url' | 'email' | 'numeric' | 'decimal' | 'search'
    min?: number | string
    max?: number | string
    step?: number | string
    minLength?: number
    maxLength?: number
    pattern?: string
    accept?: string
    capture?: boolean | 'user' | 'environment'
    multiple?: boolean
  }
  export type SVGProps<T> = HTMLAttributes<T>
}

declare module 'react' {
  export = React
}

declare module 'react/jsx-runtime' {
  import type { HTMLAttributes, InputHTMLAttributes, Key, ReactElement, ReactNode } from 'react'
  /** Loose element props: any other attribute (element-specific ones such as href, src,
   * viewBox, htmlFor) is accepted unchecked; the common ones and event handlers are typed. */
  type Loose<P> = P & { [attribute: string]: unknown }
  type Html<T> = Loose<HTMLAttributes<T>>
  export namespace JSX {
    type ElementType = string | ((props: any) => ReactNode | Promise<ReactNode>) | (new (props: any) => unknown)
    interface Element extends ReactElement<any, any> {}
    interface ElementAttributesProperty { props: {} }
    interface ElementChildrenAttribute { children: {} }
    interface IntrinsicAttributes { key?: Key | null }
    interface IntrinsicElements {
      a: Html<HTMLAnchorElement>; article: Html<HTMLElement>; aside: Html<HTMLElement>; br: Html<HTMLBRElement>
      button: Html<HTMLButtonElement>; code: Html<HTMLElement>; dd: Html<HTMLElement>; details: Html<HTMLDetailsElement>
      div: Html<HTMLDivElement>; dl: Html<HTMLDListElement>; dt: Html<HTMLElement>; em: Html<HTMLElement>
      footer: Html<HTMLElement>; form: Html<HTMLFormElement>; h1: Html<HTMLHeadingElement>; h2: Html<HTMLHeadingElement>
      h3: Html<HTMLHeadingElement>; h4: Html<HTMLHeadingElement>; h5: Html<HTMLHeadingElement>; h6: Html<HTMLHeadingElement>
      header: Html<HTMLElement>; iframe: Html<HTMLIFrameElement>; img: Html<HTMLImageElement>
      input: Loose<InputHTMLAttributes<HTMLInputElement>>; kbd: Html<HTMLElement>; label: Html<HTMLLabelElement>
      li: Html<HTMLLIElement>; main: Html<HTMLElement>; nav: Html<HTMLElement>; ol: Html<HTMLOListElement>
      option: Html<HTMLOptionElement>; p: Html<HTMLParagraphElement>; section: Html<HTMLElement>
      select: Html<HTMLSelectElement>; small: Html<HTMLElement>; span: Html<HTMLSpanElement>; strong: Html<HTMLElement>
      summary: Html<HTMLElement>; table: Html<HTMLTableElement>; tbody: Html<HTMLTableSectionElement>
      td: Html<HTMLTableCellElement>; textarea: Html<HTMLTextAreaElement>; th: Html<HTMLTableCellElement>
      thead: Html<HTMLTableSectionElement>; tr: Html<HTMLTableRowElement>; ul: Html<HTMLUListElement>
      video: Html<HTMLVideoElement>; audio: Html<HTMLAudioElement>; canvas: Html<HTMLCanvasElement>
      svg: Html<SVGSVGElement>; g: Html<SVGGElement>; path: Html<SVGPathElement>; rect: Html<SVGRectElement>
      circle: Html<SVGCircleElement>; polygon: Html<SVGPolygonElement>; line: Html<SVGLineElement>
      polyline: Html<SVGPolylineElement>; text: Html<SVGTextElement>; defs: Html<SVGDefsElement>
      linearGradient: Html<SVGLinearGradientElement>; stop: Html<SVGStopElement>
    }
  }
  export function jsx(type: unknown, props: unknown, key?: Key): JSX.Element
  export function jsxs(type: unknown, props: unknown, key?: Key): JSX.Element
  export const Fragment: unknown
}

declare module 'react-dom/client' {
  import type { ReactNode } from 'react'
  export interface Root {
    render(children: ReactNode): void
    unmount(): void
  }
  export function createRoot(container: Element | DocumentFragment): Root
  const ReactDOMClient: { createRoot: typeof createRoot }
  export default ReactDOMClient
}
