import { useEffect, useMemo, useRef, useState } from "react";
import { calculate } from "./scientific";

let preparedScriptUrl = "";
export async function loadDesmos(scriptUrl: string): Promise<void> {
  preparedScriptUrl = scriptUrl;
}

function CalculatorFrame({
  options,
  savedState,
  onReady,
  onSave,
}: {
  options: Record<string, boolean>;
  savedState?: Record<string, unknown> | null;
  onReady?: (checks: Record<string, boolean>) => void;
  onSave?: (state: Record<string, unknown>) => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const initial = useRef({ options, savedState });
  const callbacks = useRef({ onReady, onSave });
  callbacks.current = { onReady, onSave };
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setFailed(true);
      callbacks.current.onReady?.({ scriptLoaded: false });
    }, 25000);
    const receive = (event: MessageEvent) => {
      if (
        event.source !== frame.current?.contentWindow ||
        !event.data?.whitebookCalculator
      )
        return;
      if (event.data.type === "ready") {
        window.clearTimeout(timeout);
        setFailed(!Object.values(event.data.payload).every(Boolean));
        callbacks.current.onReady?.(event.data.payload);
      }
      if (event.data.type === "state")
        callbacks.current.onSave?.(event.data.payload);
    };
    window.addEventListener("message", receive);
    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener("message", receive);
    };
  }, []);
  return (
    <>
      {failed && (
        <p role="alert">
          Desmos could not become ready. Close and reopen the calculator, or
          pause and retry preparation.
        </p>
      )}
      <iframe
        ref={frame}
        title="Desmos graphing calculator"
        className="desmos-frame"
        src="/app/calculator-frame"
        sandbox="allow-scripts"
        onLoad={() =>
          frame.current?.contentWindow?.postMessage(
            {
              type: "initialize",
              scriptUrl: preparedScriptUrl,
              options: initial.current.options,
              state: initial.current.savedState,
            },
            "*",
          )
        }
      />
    </>
  );
}

export function DesmosReadinessProbe({
  options,
  onResult,
}: {
  options: Record<string, boolean>;
  onResult: (checks: Record<string, boolean>) => void;
}) {
  return (
    <div className="desmos-probe">
      <CalculatorFrame options={options} onReady={onResult} />
    </div>
  );
}

export function ScientificCalculator() {
  const [expression, setExpression] = useState("");
  const [result, setResult] = useState("");
  const [angle, setAngle] = useState<"degrees" | "radians">("degrees");
  const keys = useMemo(
    () => [
      "sin(",
      "cos(",
      "tan(",
      "sqrt(",
      "log(",
      "ln(",
      "pi",
      "^",
      "7",
      "8",
      "9",
      "/",
      "4",
      "5",
      "6",
      "*",
      "1",
      "2",
      "3",
      "-",
      "0",
      ".",
      "(",
      ")",
      "+",
    ],
    [],
  );
  return (
    <div className="scientific-calculator">
      <label>
        Angle unit{" "}
        <select
          value={angle}
          onChange={(event) =>
            setAngle(event.target.value as "degrees" | "radians")
          }
        >
          <option value="degrees">Degrees</option>
          <option value="radians">Radians</option>
        </select>
      </label>
      <label>
        Expression
        <input
          value={expression}
          onChange={(event) => setExpression(event.target.value)}
        />
      </label>
      <output>{result || "Ready"}</output>
      <div className="calculator-keys">
        {keys.map((key) => (
          <button
            type="button"
            key={key}
            onClick={() => setExpression((value) => value + key)}
          >
            {key}
          </button>
        ))}
        <button type="button" onClick={() => setExpression("")}>
          Clear
        </button>
        <button
          className="key-equals"
          type="button"
          onClick={() => setResult(calculate(expression, angle))}
        >
          Calculate
        </button>
      </div>
    </div>
  );
}

export function DesmosCalculatorPanel({
  options,
  savedState,
  onSave,
}: {
  options: Record<string, boolean>;
  savedState: Record<string, unknown> | null;
  onSave: (state: Record<string, unknown>) => void;
}) {
  return (
    <div className="desmos-panel">
      <CalculatorFrame
        options={options}
        savedState={savedState}
        onSave={onSave}
      />
    </div>
  );
}
