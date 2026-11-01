/** The Mixer keymap, listed in Settings › Hotkeys. */
import { Fragment } from "react";
import { Kbd } from "@/components/ui";
import { MIXER_KEYMAP } from "./keyboard";

export function MixerShortcuts() {
  return (
    <section aria-labelledby="mixer-shortcuts" className="flex flex-col gap-2 border-t border-line pt-3">
      <div className="flex flex-col gap-0.5">
        <h3 id="mixer-shortcuts" className="text-13 font-medium text-text">
          Mixer shortcuts (when the window is focused)
        </h3>
        <p className="text-12 text-text-dim">
          These work only on the Mixer page, not while typing. Press a number to focus a strip, then act on it.
        </p>
      </div>
      <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-1.5">
        {MIXER_KEYMAP.map((row) => (
          <Fragment key={row.action}>
            <dt className="flex items-center gap-1">
              {row.keys.map((combo, k) => (
                <Fragment key={k}>
                  {k > 0 ? <span className="text-11 text-text-dim">{row.sep ?? "/"}</span> : null}
                  {combo.map((key) => (
                    <Kbd key={key}>{key}</Kbd>
                  ))}
                </Fragment>
              ))}
            </dt>
            <dd className="m-0 text-12 text-text-dim">{row.action}</dd>
          </Fragment>
        ))}
      </dl>
    </section>
  );
}
