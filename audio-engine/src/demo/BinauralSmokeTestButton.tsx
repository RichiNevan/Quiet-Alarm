import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AudioContext } from 'react-native-audio-api';

import { ensureCustomNodesInstalled } from '../engine/ensureCustomNodesInstalled';
import { BinauralNode } from '../engine/types';

type Status = 'idle' | 'playing' | 'fading' | 'error';

// Duration and frequencies for the smoke test.
const PLAY_MS = 5000;
const LEFT_HZ = 300; // left ear
const RIGHT_HZ = 306; // right ear -> 6 Hz binaural beat
const WAVEFORM_SINE = 0;
const VOLUME = 0.4; // linear 0..1 (mobile scale)

// node.stop() does NOT cut the sound instantly: it arms the engine's stop
// gate, which fades every voice to silence (2 s by default, see
// SessionDspEngine::stop). The node and its AudioContext must stay alive
// until that fade has finished — disconnecting or closing the context right
// after stop() chops the waveform at full amplitude and produces an audible
// click on every platform. node.isPaused flips to true once the gate has
// reached silence, which is the signal that teardown is safe.
const FADE_MS = 2000; // matches SessionDspEngine::stop(fadeSeconds = 2.0)
const FADE_POLL_MS = 100;
const FADE_MAX_WAIT_MS = FADE_MS + 1000; // hard cap in case isPaused never flips

/**
 * Drop-in verification button. Tapping it installs the native custom nodes,
 * builds a BinauralNode (300 Hz / 306 Hz), plays for 5 seconds, fades out,
 * then releases the audio context.
 *
 * If you hear a 6 Hz binaural beat for 5 seconds ending in a smooth fade
 * (no click), the native Turbo Module, codegen registration, and
 * react-native-audio-api link are all working.
 *
 * Wear headphones — the binaural beat is only perceivable with stereo separation.
 */
export function BinauralSmokeTestButton() {
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState<string>('Tap to play 300/306 Hz for 5s');

  const contextRef = useRef<AudioContext | null>(null);
  const nodeRef = useRef<BinauralNode | null>(null);
  const playTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fadePollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearTimers = useCallback(() => {
    if (playTimeoutRef.current) {
      clearTimeout(playTimeoutRef.current);
      playTimeoutRef.current = null;
    }
    if (fadePollRef.current) {
      clearInterval(fadePollRef.current);
      fadePollRef.current = null;
    }
  }, []);

  // Final release: only safe once the node has faded to silence (or was
  // never started). Callers that have a live node go through stopGracefully.
  const closeAndRelease = useCallback(() => {
    clearTimers();
    try {
      (nodeRef.current as unknown as { disconnect?: () => void })?.disconnect?.();
    } catch {
      // node already disconnected/destroyed
    }
    try {
      (contextRef.current as unknown as { close?: () => void })?.close?.();
    } catch {
      // ignore
    }
    nodeRef.current = null;
    contextRef.current = null;
  }, [clearTimers]);

  // Click-free shutdown: arm the stop gate, wait for the fade to reach
  // silence (node.isPaused), then disconnect + close.
  const stopGracefully = useCallback(
    (onDone?: () => void) => {
      clearTimers();
      const node = nodeRef.current;
      if (!node) {
        closeAndRelease();
        onDone?.();
        return;
      }
      try {
        node.stop(); // starts the 2 s fade on the audio thread
      } catch {
        closeAndRelease();
        onDone?.();
        return;
      }
      const fadeStartedAt = Date.now();
      fadePollRef.current = setInterval(() => {
        let faded = true;
        try {
          faded = nodeRef.current?.isPaused ?? true;
        } catch {
          // treat a dead node as faded
        }
        if (faded || Date.now() - fadeStartedAt >= FADE_MAX_WAIT_MS) {
          closeAndRelease();
          onDone?.();
        }
      }, FADE_POLL_MS);
    },
    [clearTimers, closeAndRelease],
  );

  // Fade out (instead of hard-cutting) if the screen unmounts mid-playback.
  // The timers keep running after unmount; no state is touched on this path.
  useEffect(() => () => stopGracefully(), [stopGracefully]);

  const handlePress = useCallback(() => {
    if (status === 'playing' || status === 'fading') return;

    // 1. Make sure the native JSI node factories are installed.
    const ready = ensureCustomNodesInstalled();
    if (!ready) {
      setStatus('error');
      setMessage(
        'Custom node factories not installed — the native module is not linked. ' +
          'Check autolinking / pod install / Android build.',
      );
      return;
    }

    try {
      // 2. Build a react-native-audio-api context and a binaural node on it.
      const ctx = new AudioContext();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const g = global as any;
      const node = new BinauralNode(ctx, g.createBinauralNode(ctx.context));

      node.fl = LEFT_HZ;
      node.fr = RIGHT_HZ;
      node.waveformL = WAVEFORM_SINE;
      node.waveformR = WAVEFORM_SINE;
      node.volume = VOLUME;

      // 3. Connect to the speakers and start.
      node.connect(ctx.destination);
      (ctx as unknown as { resume?: () => void }).resume?.();
      node.start();

      contextRef.current = ctx;
      nodeRef.current = node;
      setStatus('playing');
      setMessage('Playing 300/306 Hz (wear headphones)…');

      // 4. After 5 seconds, fade out and only then release the context.
      playTimeoutRef.current = setTimeout(() => {
        setStatus('fading');
        setMessage('Fading out…');
        stopGracefully(() => {
          setStatus('idle');
          setMessage('Done ✓  Tap to play again');
        });
      }, PLAY_MS);
    } catch (error) {
      closeAndRelease();
      setStatus('error');
      setMessage(
        'Failed to start audio: ' +
          (error instanceof Error ? error.message : String(error)),
      );
    }
  }, [status, stopGracefully, closeAndRelease]);

  const busy = status === 'playing' || status === 'fading';

  return (
    <View style={styles.wrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Play binaural smoke test"
        onPress={handlePress}
        disabled={busy}
        style={({ pressed }) => [
          styles.button,
          busy && styles.buttonPlaying,
          status === 'error' && styles.buttonError,
          pressed && styles.buttonPressed,
        ]}
      >
        <Text style={styles.buttonText}>
          {status === 'playing'
            ? 'Playing…'
            : status === 'fading'
              ? 'Fading out…'
              : 'Play binaural 300/306 Hz (5s)'}
        </Text>
      </Pressable>
      <Text style={styles.message}>{message}</Text>
    </View>
  );
}

export default BinauralSmokeTestButton;

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 8, padding: 16 },
  button: {
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 12,
    backgroundColor: '#3b6ef5',
    minWidth: 260,
    alignItems: 'center',
  },
  buttonPlaying: { backgroundColor: '#2aa27a' },
  buttonError: { backgroundColor: '#c2453f' },
  buttonPressed: { opacity: 0.85 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  message: { fontSize: 13, opacity: 0.7, textAlign: 'center' },
});
