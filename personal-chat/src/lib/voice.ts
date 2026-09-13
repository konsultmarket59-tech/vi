/**
 * Голос: надиктовать реплику и послушать ответ.
 *
 * Слушает то же встроенное распознавание, что и «Видеотека»: ставить ничего не
 * надо, и запись никуда не уходит — она превращается в текст на этом же
 * компьютере. Говорит система: в Windows есть свои голоса, включая русский, и
 * платить за них или что-то качать незачем.
 *
 * Честная оговорка. Системные голоса есть не везде: на чистом Linux их может не
 * быть вовсе, и тогда читать вслух нечем. Приложение это проверяет и говорит
 * прямо, а не молчит с включённой кнопкой.
 */

/** Запись с микрофона. Останавливается вручную — паузу в речи не угадать. */
export class VoiceRecorder {
  private recorder: MediaRecorder | null = null;
  private chunks: BlobPart[] = [];
  private stream: MediaStream | null = null;

  async start(): Promise<void> {
    this.chunks = [];
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    });
    const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find(
      (t) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)
    );
    this.recorder = new MediaRecorder(this.stream, mime ? { mimeType: mime } : undefined);
    this.recorder.ondataavailable = (e) => {
      if (e.data.size) this.chunks.push(e.data);
    };
    this.recorder.start();
  }

  /** Останавливает запись и отдаёт байты. */
  stop(): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      const rec = this.recorder;
      if (!rec) {
        reject(new Error("Запись не шла."));
        return;
      }
      rec.onstop = async () => {
        // Дорожки надо закрыть руками: иначе в системе остаётся гореть значок
        // включённого микрофона, и это выглядит так, будто приложение слушает.
        this.stream?.getTracks().forEach((t) => t.stop());
        this.stream = null;
        this.recorder = null;
        const blob = new Blob(this.chunks, { type: rec.mimeType || "audio/webm" });
        resolve(new Uint8Array(await blob.arrayBuffer()));
      };
      rec.onerror = () => reject(new Error("Запись прервалась."));
      rec.stop();
    });
  }

  cancel() {
    try {
      this.recorder?.stop();
    } catch {
      // запись уже остановлена
    }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.recorder = null;
  }
}

/** Голоса системы. Русские идут первыми — приложение русское. */
export function listVoices(): SpeechSynthesisVoice[] {
  if (typeof window === "undefined" || !window.speechSynthesis) return [];
  const all = window.speechSynthesis.getVoices();
  return [...all].sort((a, b) => {
    const ru = (v: SpeechSynthesisVoice) => (/^ru/i.test(v.lang) ? 0 : 1);
    return ru(a) - ru(b) || a.name.localeCompare(b.name, "ru");
  });
}

/**
 * Текст, пригодный для чтения вслух.
 *
 * Разметку надо снять: синтезатор читает звёздочки и решётки буквально, и
 * ответ с заголовками превращается в поток «решётка решётка». Ссылки тоже —
 * вслух адрес бесполезен, а читается он долго.
 */
export function speakable(text: string): string {
  return String(text || "")
    .replace(/```[\s\S]*?```/g, " (код пропущен) ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/^[-*•]\s+/gm, "")
    .replace(/https?:\/\/\S+/g, " ссылка ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export interface SpeakOptions {
  voice?: string;
  rate?: number;
}

/** Прочитать вслух. Прежняя реплика обрывается: двух голосов разом не надо. */
export function speak(text: string, { voice, rate = 1 }: SpeakOptions = {}): boolean {
  if (typeof window === "undefined" || !window.speechSynthesis) return false;
  const body = speakable(text);
  if (!body) return false;
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(body);
  const voices = listVoices();
  const picked = voice ? voices.find((v) => v.name === voice) : voices.find((v) => /^ru/i.test(v.lang));
  if (picked) {
    utter.voice = picked;
    utter.lang = picked.lang;
  } else {
    utter.lang = "ru-RU";
  }
  utter.rate = Math.max(0.5, Math.min(2, rate));
  window.speechSynthesis.speak(utter);
  return true;
}

export function stopSpeaking() {
  if (typeof window !== "undefined" && window.speechSynthesis) window.speechSynthesis.cancel();
}

/** Есть ли чем читать вслух. Пустой список — значит голосов в системе нет. */
export function canSpeak(): boolean {
  return typeof window !== "undefined" && !!window.speechSynthesis && listVoices().length > 0;
}
