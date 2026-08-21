import { useEffect } from "react";

/**
 * What is left of the editor chrome once it stopped hiding.
 *
 * This hook used to run an auto-hide: three seconds after opening a board the
 * header slid away, and the only way back was to land the pointer inside a five
 * pixel strip at the very top of the window — sampled at most every 100ms, so a
 * brisk move across it was missed roughly nineteen times in twenty. On a touch
 * screen there was no way back at all, which took the back button, sharing,
 * history and export with it.
 *
 * No whiteboard worth copying does this. They keep their controls visible and
 * small, let you draw straight through them, and put "hide everything" behind an
 * explicit key. Excalidraw already has that key: Alt+Z.
 *
 * So the timers are gone and the title is all that remains.
 */

const MIGRATION_KEY = "excalidash:editor:chromeMigrated:v1";
const AUTO_HIDE_KEY = /^excalidash:editor:.*:autoHideEnabled$/;

/**
 * The old preference described a feature that no longer exists, and it was
 * stored per board rather than per person — which is why it never seemed to
 * stick. Reinterpreting it as anything else would be putting words in people's
 * mouths, so it is simply cleared out once.
 */
const forgetAutoHidePreference = () => {
  try {
    if (window.localStorage.getItem(MIGRATION_KEY)) return;
    for (const key of Object.keys(window.localStorage)) {
      if (AUTO_HIDE_KEY.test(key)) window.localStorage.removeItem(key);
    }
    window.localStorage.setItem(MIGRATION_KEY, "1");
  } catch {
    // Storage can be blocked outright; losing the cleanup costs nothing.
  }
};

export const useEditorChrome = ({ drawingName }: { drawingName: string }) => {
  useEffect(() => {
    forgetAutoHidePreference();
  }, []);

  useEffect(() => {
    document.title = `${drawingName} - ExcaliDash`;
    return () => {
      document.title = "ExcaliDash";
    };
  }, [drawingName]);
};
