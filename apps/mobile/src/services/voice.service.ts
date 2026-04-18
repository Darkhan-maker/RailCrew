import { Audio } from 'expo-av';
import * as Speech from 'expo-speech';
import { voiceApi } from './api.service';
import { VoiceRecognitionResult } from '@railcrew/contracts';

// Expo не имеет встроенного STT — используем Web Speech API через WebView
// или нативный модуль. На MVP: запись аудио + отправка текста вручную,
// либо использование device-level speech recognition через expo-speech.
// Здесь реализован полный flow: запись -> отправка rawText -> parse на сервере.

export type VoiceServiceState = 'idle' | 'recording' | 'processing' | 'done' | 'error';

let recording: Audio.Recording | null = null;

export const voiceService = {
  async startRecording(): Promise<void> {
    await Audio.requestPermissionsAsync();
    await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
    recording = new Audio.Recording();
    await recording.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
    await recording.startAsync();
  },

  async stopRecording(): Promise<string | null> {
    if (!recording) return null;
    await recording.stopAndUnloadAsync();
    const uri = recording.getURI();
    recording = null;
    return uri;
  },

  // Парсинг текста на сервере
  async parseText(rawText: string): Promise<VoiceRecognitionResult> {
    return voiceApi.parse({ rawText });
  },

  speak(text: string): void {
    Speech.speak(text, { language: 'ru-RU' });
  },
};
