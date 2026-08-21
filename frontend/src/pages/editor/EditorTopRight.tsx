import { useEffect, useState } from "react";
import { BellRing, Clock3, Pause, Play, Plus, Square } from "lucide-react";
import type { WorkshopTimerController } from "./workshopTimer";
import { getWorkshopTimerRemainingMs } from "./workshopTimer";
import "./EditorTopRight.css";

const formatRemaining = (remainingMs: number): string => {
  const totalSeconds = Math.ceil(remainingMs / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
};

const useRemainingMs = (timer: WorkshopTimerController): number => {
  const [remainingMs, setRemainingMs] = useState(() => getWorkshopTimerRemainingMs(timer.snapshot));
  useEffect(() => {
    const update = () => setRemainingMs(getWorkshopTimerRemainingMs(timer.snapshot));
    update();
    if (timer.snapshot.status !== "running") return;
    const interval = window.setInterval(update, 250);
    return () => window.clearInterval(interval);
  }, [timer.snapshot]);
  return remainingMs;
};

export const EditorTopRight = ({
  canEdit,
  isMobile,
  timer,
}: {
  canEdit: boolean;
  isMobile: boolean;
  timer: WorkshopTimerController;
}) => {
  const [expanded, setExpanded] = useState(false);
  const [minutes, setMinutes] = useState("10");
  const remainingMs = useRemainingMs(timer);
  const { status } = timer.snapshot;
  const active = status === "running" || status === "paused";
  const summary =
    status === "finished" ? "Time's up" : active ? formatRemaining(remainingMs) : "Timer";
  const start = () => {
    const durationMinutes = Number(minutes);
    if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 1_440)
      return;
    timer.sendCommand("start", durationMinutes * 60_000);
  };

  return (
    <div
      className={`workshop-timer${expanded ? " workshop-timer--expanded" : ""}${status === "finished" ? " workshop-timer--finished" : ""}${isMobile ? " workshop-timer--mobile" : ""}`}
      aria-live={status === "finished" ? "assertive" : "off"}
    >
      <button
        type="button"
        className="workshop-timer__summary"
        aria-expanded={expanded}
        aria-label={`Workshop timer: ${summary}`}
        onClick={() => setExpanded((current) => !current)}
      >
        {status === "finished" ? <BellRing size={18} /> : <Clock3 size={18} />}
        <span className="workshop-timer__time">{summary}</span>
        {status === "paused" ? <span className="workshop-timer__badge">Paused</span> : null}
      </button>
      {expanded ? (
        <div className="workshop-timer__panel">
          {canEdit ? (
            <>
              <div className="workshop-timer__start-row">
                <label htmlFor="workshop-timer-minutes">Minutes</label>
                <input
                  id="workshop-timer-minutes"
                  type="number"
                  min="1"
                  max="1440"
                  step="1"
                  inputMode="numeric"
                  value={minutes}
                  onChange={(event) => setMinutes(event.target.value)}
                />
                <button type="button" onClick={start}>
                  {active ? "Restart" : "Start"}
                </button>
              </div>
              {active ? (
                <div className="workshop-timer__controls">
                  <button
                    type="button"
                    onClick={() => timer.sendCommand(status === "running" ? "pause" : "resume")}
                  >
                    {status === "running" ? <Pause size={16} /> : <Play size={16} />}
                    {status === "running" ? "Pause" : "Resume"}
                  </button>
                  <button type="button" onClick={() => timer.sendCommand("add-minute")}>
                    <Plus size={16} />1 min
                  </button>
                  <button type="button" onClick={() => timer.sendCommand("stop")}>
                    <Square size={14} /> Stop
                  </button>
                </div>
              ) : null}
            </>
          ) : (
            <p className="workshop-timer__readonly">Only editors can control the timer.</p>
          )}
        </div>
      ) : null}
    </div>
  );
};
