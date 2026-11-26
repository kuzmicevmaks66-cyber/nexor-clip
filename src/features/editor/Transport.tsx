import { Pause, Play, SkipBack, StepBack, StepForward } from "lucide-react";
import { Button } from "@/components/ui";
import { formatTime } from "@/services/format";
import type { Playback } from "./usePlayback";

export function Transport({ pb, fps = 30 }: { pb: Playback; fps?: number }) {
  return (
    <div className="transport">
      <Button size="sm" iconOnly icon={SkipBack} title="В начало (Home)" onClick={() => pb.seek(0)} />
      <Button size="sm" iconOnly icon={StepBack} title="Кадр назад (←)" onClick={() => pb.step(-1 / fps)} />
      <Button size="sm" variant="primary" iconOnly icon={pb.playing ? Pause : Play} title="Воспроизведение (Пробел)" onClick={pb.toggle} disabled={pb.total === 0} />
      <Button size="sm" iconOnly icon={StepForward} title="Кадр вперёд (→)" onClick={() => pb.step(1 / fps)} />
      <span className="timecode">{formatTime(pb.time)}</span>
      <span className="muted small">/ {formatTime(pb.total)}</span>
    </div>
  );
}
