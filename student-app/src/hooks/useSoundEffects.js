// student-app/src/hooks/useSoundEffects.js
import { useRef, useEffect } from "react";

/**
 * Hook for managing sound effects throughout the app
 * Returns an object with all the tryPlay* functions
 */
export function useSoundEffects() {
  // Audio refs
  const sndAlert = useRef(null);
  const sndTreat = useRef(null);
  const sndEcho = useRef(null);
  const sndNarration = useRef(null);
  const sndScriptPlay = useRef(null);
  const sndRolePlay = useRef(null);
  const sndFakeOut = useRef(null);
  const sndWordWeaver = useRef(null);
  const sndDebate = useRef(null);
  const sndCorrect = useRef(null);
  const sndWrong = useRef(null);
  const sndPhoto = useRef(null);
  const sndSketch = useRef(null);
  const sndVenn = useRef(null);
  const sndHunt = useRef(null);

  // Audio setup
  useEffect(() => {
    try {
      const alertAudio = new Audio("https://actions.google.com/sounds/v1/alarms/alarm_clock.ogg");
      alertAudio.volume = 0.15;
      sndAlert.current = alertAudio;

      const treatAudio = new Audio("https://actions.google.com/sounds/v1/cartoon/clang_and_wobble.ogg");
      treatAudio.volume = 0.2;
      sndTreat.current = treatAudio;

      // EchoChain: subtle "chain" chime (non-blocking; safe to fail)
      const echoAudio = new Audio(
        "https://actions.google.com/sounds/v1/cartoon/wood_plank_flicks.ogg"
      );
      echoAudio.volume = 0.18;
      sndEcho.current = echoAudio;

      const narrationAudio = new Audio(
        "https://actions.google.com/sounds/v1/cartoon/concussive_hit_guitar_boing.ogg"
      );
      narrationAudio.volume = 0.16;
      sndNarration.current = narrationAudio;

      // ScriptPlay: page-turn / stage cue (safe to fail)
      const scriptAudio = new Audio(
        "https://actions.google.com/sounds/v1/foley/page_turn.ogg"
      );
      scriptAudio.volume = 0.16;
      sndScriptPlay.current = scriptAudio;

      // RolePlayDeck: "card draw" / gentle reveal cue (safe to fail)
      const rolePlayAudio = new Audio(
        "https://actions.google.com/sounds/v1/foley/card_shuffle.ogg"
      );
      rolePlayAudio.volume = 0.16;
      sndRolePlay.current = rolePlayAudio;

      // Universal feedback (correct / incorrect)
      const correctAudio = new Audio(
        "https://actions.google.com/sounds/v1/cartoon/clang_and_wobble.ogg"
      );
      correctAudio.volume = 0.16;
      sndCorrect.current = correctAudio;

      const wrongAudio = new Audio(
        "https://actions.google.com/sounds/v1/cartoon/boing.ogg"
      );
      wrongAudio.volume = 0.14;
      sndWrong.current = wrongAudio;

      // Photo / PhotoJournal / HideNSeek: camera shutter cue (safe to fail)
      const photoAudio = new Audio(
        "https://actions.google.com/sounds/v1/camera/camera_shutter_click_01.ogg"
      );
      photoAudio.volume = 0.18;
      sndPhoto.current = photoAudio;

      // SpeedDraw / DrawMime: marker cue (safe to fail)
      const sketchAudio = new Audio(
        "https://actions.google.com/sounds/v1/foley/marker_write.ogg"
      );
      sketchAudio.volume = 0.14;
      sndSketch.current = sketchAudio;

      // VennSort: soft "drop" cue (safe to fail)
      const vennAudio = new Audio(
        "https://actions.google.com/sounds/v1/foley/wood_tap.ogg"
      );
      vennAudio.volume = 0.12;
      sndVenn.current = vennAudio;

      // HideNSeek: little "whoosh" cue (safe to fail)
      const huntAudio = new Audio(
        "https://actions.google.com/sounds/v1/cartoon/slide_whistle_to_drum_hit.ogg"
      );
      huntAudio.volume = 0.12;
      sndHunt.current = huntAudio;
    } catch (err) {
      console.warn("Could not preload audio:", err);
    }

    // FakeOut: playful "gotcha" cue (separate try so one failure doesn't block others)
    try {
      const fakeOutAudio = new Audio(
        "https://actions.google.com/sounds/v1/cartoon/clang_and_wobble.ogg"
      );
      fakeOutAudio.volume = 0.14;
      sndFakeOut.current = fakeOutAudio;

      // WordWeaver: subtle "tile tap" cue
      const wordWeaverAudio = new Audio(
        "https://actions.google.com/sounds/v1/foley/wood_tap.ogg"
      );
      wordWeaverAudio.volume = 0.14;
      sndWordWeaver.current = wordWeaverAudio;

      // AI Debate Judge: gavel cue
      const debateAudio = new Audio(
        "https://actions.google.com/sounds/v1/foley/wood_tap.ogg"
      );
      debateAudio.volume = 0.18;
      sndDebate.current = debateAudio;
    } catch {
      // ignore
    }
  }, []);

  // Helper function to safely play a sound
  const tryPlaySound = (ref, soundName) => {
    try {
      ref.current && ref.current.play();
    } catch (err) {
      console.warn(`${soundName} sound play blocked:`, err);
    }
  };

  // Play functions
  const tryPlayAlertSound = () => {
    tryPlaySound(sndAlert, "Alert");
  };

  const tryPlayTreatSound = () => {
    tryPlaySound(sndTreat, "Treat");
  };

  const tryPlayEchoSound = () => {
    tryPlaySound(sndEcho, "EchoChain");
  };

  const tryPlayCorrectSound = () => {
    try {
      sndCorrect.current && sndCorrect.current.play();
    } catch {
      // ignore
    }
  };

  const tryPlayWrongSound = () => {
    try {
      sndWrong.current && sndWrong.current.play();
    } catch {
      // ignore
    }
  };

  const tryPlayNarrationSound = () => {
    tryPlaySound(sndNarration, "Narration");
  };

  const tryPlayScriptPlaySound = () => {
    tryPlaySound(sndScriptPlay, "ScriptPlay");
  };

  // ReadingComp: page-turn cue (reuse ScriptPlay chime)
  const tryPlayReadingSound = () => {
    try {
      // Prefer dedicated reading sound if later added; for now reuse ScriptPlay
      sndScriptPlay.current && sndScriptPlay.current.play();
    } catch (err) {
      // autoplay may be blocked
    }
  };

  const tryPlayRolePlaySound = () => {
    tryPlaySound(sndRolePlay, "RolePlay");
  };

  const tryPlayFakeOutSound = () => {
    tryPlaySound(sndFakeOut, "FakeOut");
  };

  const tryPlayWordWeaverSound = () => {
    try {
      sndWordWeaver.current && sndWordWeaver.current.play();
    } catch {
      // ignore
    }
  };

  const tryPlayDebateSound = () => {
    try {
      sndDebate.current && sndDebate.current.play();
    } catch {
      // ignore
    }
  };

  const tryPlayPhotoSound = () => {
    try {
      sndPhoto.current && sndPhoto.current.play();
    } catch {
      // ignore
    }
  };

  const tryPlaySketchSound = () => {
    try {
      sndSketch.current && sndSketch.current.play();
    } catch {
      // ignore
    }
  };

  const tryPlayVennSound = () => {
    try {
      sndVenn.current && sndVenn.current.play();
    } catch {
      // ignore
    }
  };

  const tryPlayHuntSound = () => {
    try {
      sndHunt.current && sndHunt.current.play();
    } catch {
      // ignore
    }
  };

  // Setup global window functions for external access
  useEffect(() => {
    window.__curriculatePlayWrongSound = () => {
      tryPlayWrongSound();
    };

    window.__curriculatePlayCorrectSound = () => {
      tryPlayCorrectSound();
    };

    return () => {
      delete window.__curriculatePlayWrongSound;
      delete window.__curriculatePlayCorrectSound;
    };
  }, []);

  return {
    tryPlayAlertSound,
    tryPlayTreatSound,
    tryPlayEchoSound,
    tryPlayCorrectSound,
    tryPlayWrongSound,
    tryPlayNarrationSound,
    tryPlayScriptPlaySound,
    tryPlayReadingSound,
    tryPlayRolePlaySound,
    tryPlayFakeOutSound,
    tryPlayWordWeaverSound,
    tryPlayDebateSound,
    tryPlayPhotoSound,
    tryPlaySketchSound,
    tryPlayVennSound,
    tryPlayHuntSound,
  };
}
