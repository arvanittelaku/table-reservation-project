/* Browser APIs the app feature-detects that are not in TypeScript's DOM library yet,
 * and the few globals the app sets or reads on window. */

/** Shape Detection API (Chrome); used to reject photos without a face. */
interface DetectedFace { boundingBox: DOMRectReadOnly }
interface FaceDetectorOptions { fastMode?: boolean; maxDetectedFaces?: number }
declare class FaceDetector {
  constructor(options?: FaceDetectorOptions)
  detect(image: ImageBitmapSource): Promise<DetectedFace[]>
}

/** Jitsi Meet External API (external_api.js loaded at runtime). */
interface JitsiMeetOptions {
  roomName: string | null
  jwt?: string
  parentNode: HTMLElement
  width?: string | number
  height?: string | number
  lang?: string
  userInfo?: { displayName?: string; email?: string }
  configOverwrite?: Record<string, unknown>
  interfaceConfigOverwrite?: Record<string, unknown>
}
interface JitsiMeetApi {
  getIFrame(): HTMLIFrameElement | undefined
  addListener(event: string, listener: (e?: { error?: { isFatal?: boolean } }) => void): void
  executeCommand(command: string, ...args: unknown[]): void
  dispose(): void
}
type JitsiMeetExternalAPIConstructor = new (domain: string, options: JitsiMeetOptions) => JitsiMeetApi

interface Window {
  FaceDetector?: typeof FaceDetector
  JitsiMeetExternalAPI?: JitsiMeetExternalAPIConstructor
  webkitAudioContext?: typeof AudioContext
  /** Last Wednesday-dinner quiz answers (read by the browser tests). */
  __lastWedQuizAns?: Array<string | string[]>
  /** Optional in-app handler for local notifications (lib/pushNotif). */
  __ejabashkohuPushNotif?: (n: { title: string; body: string }) => void
}

interface WindowEventMap {
  /** Landing footer -> open the privacy / terms overlay. */
  showPolicy: CustomEvent<'privacy' | 'terms'>
}
