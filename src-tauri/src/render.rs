//! Построение команды FFmpeg из описания монтажа (RenderSpec).
//! Один и тот же граф используется для экспорта, предпросмотра,
//! извлечения звука для Whisper и поиска пауз (silencedetect).

use serde::Deserialize;
use std::fmt::Write as _;

use crate::error::{AppError, AppResult};
use crate::tools::secs;

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RClip {
    pub path: String,
    /// "video" | "image"
    pub kind: String,
    pub in_point: f64,
    pub out_point: f64,
    pub volume: f64,
    pub has_audio: bool,
    /// Точка фокуса при кадрировании (0..1), по умолчанию центр.
    pub focus_x: Option<f64>,
    pub focus_y: Option<f64>,
}

impl RClip {
    pub fn duration(&self) -> f64 {
        (self.out_point - self.in_point).max(0.0)
    }
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RAudio {
    pub path: String,
    /// Позиция на Timeline (сек).
    pub start: f64,
    pub in_point: f64,
    pub out_point: f64,
    pub volume: f64,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ROverlay {
    pub path: String,
    pub start: f64,
    pub end: f64,
    /// Центр изображения в долях кадра.
    pub x: f64,
    pub y: f64,
    /// Ширина в долях ширины кадра.
    pub width: f64,
    pub opacity: f64,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RCue {
    pub start: f64,
    pub end: f64,
    pub text: String,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RSubStyle {
    pub font_family: String,
    /// Размер в пикселях при высоте кадра 1080.
    pub font_size: f64,
    pub color: String,
    pub outline_color: String,
    pub outline_width: f64,
    pub shadow: bool,
    /// "top" | "middle" | "bottom"
    pub position: String,
    /// "none" | "fade" | "pop" | "word"
    pub animation: String,
    #[serde(default)]
    pub bold: Option<bool>,
    #[serde(default)]
    pub uppercase: Option<bool>,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RSubtitles {
    pub cues: Vec<RCue>,
    pub style: RSubStyle,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RenderSpec {
    pub clips: Vec<RClip>,
    #[serde(default)]
    pub audio: Vec<RAudio>,
    #[serde(default)]
    pub overlays: Vec<ROverlay>,
    pub subtitles: Option<RSubtitles>,
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    /// "crop" | "fit" | "blur"
    pub fit: String,
    pub master_volume: f64,
}

impl RenderSpec {
    pub fn total_duration(&self) -> f64 {
        self.clips.iter().map(|c| c.duration()).sum()
    }

    pub fn validate(&self) -> AppResult<()> {
        if self.clips.is_empty() {
            return Err(AppError::msg("Timeline пуст — добавьте хотя бы один фрагмент видео"));
        }
        for c in &self.clips {
            if c.duration() < 0.05 {
                return Err(AppError::msg("На Timeline есть фрагмент нулевой длины"));
            }
            if !std::path::Path::new(&c.path).is_file() {
                return Err(AppError::msg(format!("Исходный файл не найден: {}", c.path)));
            }
        }
        for a in &self.audio {
            if !std::path::Path::new(&a.path).is_file() {
                return Err(AppError::msg(format!("Аудиофайл не найден: {}", a.path)));
            }
        }
        for o in &self.overlays {
            if !std::path::Path::new(&o.path).is_file() {
                return Err(AppError::msg(format!("Изображение не найдено: {}", o.path)));
            }
        }
        if self.width < 16 || self.height < 16 || self.width > 7680 || self.height > 7680 {
            return Err(AppError::msg("Некорректное разрешение"));
        }
        if !(1.0..=120.0).contains(&self.fps) {
            return Err(AppError::msg("Некорректная частота кадров"));
        }
        Ok(())
    }
}

pub enum Mode {
    Video {
        output: String,
        crf: u32,
        preset: String,
        audio_bitrate: String,
    },
    /// 16 кГц моно WAV для Whisper.
    SpeechWav { output: String },
    /// Только silencedetect, вывод в null.
    Silence { noise_db: f64, min_duration: f64 },
}

fn even(v: u32) -> u32 {
    (v / 2 * 2).max(2)
}

fn f(v: f64) -> String {
    format!("{:.4}", v)
}

/// Возвращает аргументы FFmpeg (без имени программы) и длительность результата.
/// Если есть субтитры, текст ASS возвращается отдельно — его нужно записать
/// в рабочую папку под именем `subs.ass` (FFmpeg запускается с current_dir = рабочая папка).
pub struct Built {
    pub args: Vec<String>,
    pub duration: f64,
    pub ass: Option<String>,
}

pub fn build(spec: &RenderSpec, mode: &Mode, use_amix_normalize: bool) -> AppResult<Built> {
    spec.validate()?;
    let w = even(spec.width);
    let h = even(spec.height);
    let fps = spec.fps;
    let video_needed = matches!(mode, Mode::Video { .. });

    let mut args: Vec<String> = vec!["-hide_banner".into(), "-y".into()];
    let mut graph = String::new();
    let mut input_idx = 0usize;

    // ---------- Основная дорожка ----------
    let mut concat_inputs = String::new();
    for (i, c) in spec.clips.iter().enumerate() {
        let dur = c.duration();
        if c.kind == "image" {
            args.extend([
                "-loop".into(),
                "1".into(),
                "-framerate".into(),
                f(fps),
                "-t".into(),
                secs(dur),
                "-i".into(),
                c.path.clone(),
            ]);
        } else {
            args.extend(["-ss".into(), secs(c.in_point), "-t".into(), secs(dur), "-i".into(), c.path.clone()]);
        }
        let k = input_idx;
        input_idx += 1;

        if video_needed {
            let fx = c.focus_x.unwrap_or(0.5).clamp(0.0, 1.0);
            let fy = c.focus_y.unwrap_or(0.5).clamp(0.0, 1.0);
            let base = format!("[{k}:v]setpts=PTS-STARTPTS,fps={},", f(fps));
            let tail = format!(
                "setsar=1,format=yuv420p,tpad=stop_mode=clone:stop_duration=2,trim=end={},setpts=PTS-STARTPTS[v{i}];",
                secs(dur)
            );
            match spec.fit.as_str() {
                "fit" => {
                    let _ = write!(
                        graph,
                        "{base}scale={w}:{h}:force_original_aspect_ratio=decrease:force_divisible_by=2,pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:color=black,{tail}"
                    );
                }
                "blur" => {
                    let _ = write!(
                        graph,
                        "{base}split=2[bg{i}][fg{i}];\
                         [bg{i}]scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h},boxblur=20:2[bgb{i}];\
                         [fg{i}]scale={w}:{h}:force_original_aspect_ratio=decrease:force_divisible_by=2[fgs{i}];\
                         [bgb{i}][fgs{i}]overlay=(W-w)/2:(H-h)/2,{tail}"
                    );
                }
                _ => {
                    let _ = write!(
                        graph,
                        "{base}scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h}:(iw-{w})*{}:(ih-{h})*{},{tail}",
                        f(fx),
                        f(fy)
                    );
                }
            }
        }

        let vol = c.volume.clamp(0.0, 4.0);
        if c.kind != "image" && c.has_audio {
            let _ = write!(
                graph,
                "[{k}:a]asetpts=PTS-STARTPTS,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,volume={},apad,atrim=end={},asetpts=PTS-STARTPTS[a{i}];",
                f(vol),
                secs(dur)
            );
        } else {
            let _ = write!(
                graph,
                "anullsrc=channel_layout=stereo:sample_rate=48000,atrim=end={},aformat=sample_fmts=fltp:channel_layouts=stereo[a{i}];",
                secs(dur)
            );
        }
        if video_needed {
            let _ = write!(concat_inputs, "[v{i}][a{i}]");
        } else {
            let _ = write!(concat_inputs, "[a{i}]");
        }
    }
    let n = spec.clips.len();
    if video_needed {
        let _ = write!(graph, "{concat_inputs}concat=n={n}:v=1:a=1[vcat][acat];");
    } else {
        let _ = write!(graph, "{concat_inputs}concat=n={n}:v=0:a=1[acat];");
    }

    let total = spec.total_duration();

    // ---------- Дополнительные аудиодорожки ----------
    let mut mix_labels = vec!["[acat]".to_string()];
    if !matches!(mode, Mode::Silence { .. } | Mode::SpeechWav { .. }) {
        for (j, a) in spec.audio.iter().enumerate() {
            if a.start >= total {
                continue;
            }
            let len = (a.out_point - a.in_point).min(total - a.start).max(0.0);
            if len < 0.05 {
                continue;
            }
            args.extend(["-ss".into(), secs(a.in_point), "-t".into(), secs(len), "-i".into(), a.path.clone()]);
            let k = input_idx;
            input_idx += 1;
            let ms = (a.start * 1000.0).round().max(0.0) as u64;
            let _ = write!(
                graph,
                "[{k}:a]asetpts=PTS-STARTPTS,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,volume={},adelay={ms}|{ms}[b{j}];",
                f(a.volume.clamp(0.0, 4.0))
            );
            mix_labels.push(format!("[b{j}]"));
        }
    }
    let master = f(spec.master_volume.clamp(0.0, 4.0));
    if mix_labels.len() > 1 {
        let norm = if use_amix_normalize { ":normalize=0" } else { "" };
        let _ = write!(
            graph,
            "{}amix=inputs={}:duration=first:dropout_transition=0{norm},volume={master}[aout];",
            mix_labels.join(""),
            mix_labels.len()
        );
    } else {
        let _ = write!(graph, "[acat]volume={master}[aout];");
    }

    // ---------- Видео: логотипы и субтитры ----------
    let mut ass = None;
    if video_needed {
        let mut cur = "vcat".to_string();
        for (j, o) in spec.overlays.iter().enumerate() {
            let s = o.start.max(0.0);
            let e = o.end.min(total);
            if e - s < 0.05 {
                continue;
            }
            args.extend([
                "-loop".into(),
                "1".into(),
                "-framerate".into(),
                f(fps),
                "-t".into(),
                secs(total),
                "-i".into(),
                o.path.clone(),
            ]);
            let k = input_idx;
            input_idx += 1;
            let ow = even(((w as f64) * o.width.clamp(0.02, 1.0)).round() as u32);
            let _ = write!(
                graph,
                "[{k}:v]scale={ow}:-2,format=rgba,colorchannelmixer=aa={}[ov{j}];\
                 [{cur}][ov{j}]overlay=x=main_w*{}-overlay_w/2:y=main_h*{}-overlay_h/2:enable='between(t,{},{})'[vo{j}];",
                f(o.opacity.clamp(0.0, 1.0)),
                f(o.x.clamp(0.0, 1.0)),
                f(o.y.clamp(0.0, 1.0)),
                secs(s),
                secs(e)
            );
            cur = format!("vo{j}");
        }
        if let Some(subs) = spec.subtitles.as_ref().filter(|s| !s.cues.is_empty()) {
            ass = Some(build_ass(subs, w, h));
            let _ = write!(graph, "[{cur}]subtitles=subs.ass[vout];");
        } else {
            let _ = write!(graph, "[{cur}]null[vout];");
        }
    }

    let mut graph = graph.trim_end_matches(';').to_string();
    if let Mode::Silence { noise_db, min_duration } = mode {
        let _ = write!(
            graph,
            ";[aout]silencedetect=noise={}dB:d={}[sd]",
            f(-noise_db.abs()),
            f(min_duration.max(0.1))
        );
    }
    args.push("-filter_complex".into());
    args.push(graph);

    match mode {
        Mode::Video {
            output,
            crf,
            preset,
            audio_bitrate,
        } => {
            let crf_s = crf.to_string();
            let fps_s = f(fps);
            let total_s = secs(total);
            args.extend(
                [
                    "-map", "[vout]", "-map", "[aout]", "-c:v", "libx264", "-preset", preset.as_str(), "-crf",
                    crf_s.as_str(), "-pix_fmt", "yuv420p", "-r", fps_s.as_str(), "-c:a", "aac", "-b:a",
                    audio_bitrate.as_str(), "-ar", "48000", "-movflags", "+faststart", "-t", total_s.as_str(),
                    "-progress", "pipe:1", "-nostats",
                ]
                .iter()
                .map(|s| s.to_string()),
            );
            args.push(output.clone());
        }
        Mode::SpeechWav { output } => {
            let total_s = secs(total);
            args.extend(
                [
                    "-map", "[aout]", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", "-t", total_s.as_str(),
                    "-progress", "pipe:1", "-nostats",
                ]
                .iter()
                .map(|s| s.to_string()),
            );
            args.push(output.clone());
        }
        Mode::Silence { .. } => {
            args.extend(["-map", "[sd]", "-f", "null", "-"].iter().map(|s| s.to_string()));
        }
    }

    Ok(Built {
        args,
        duration: total,
        ass,
    })
}

// ---------------- ASS ----------------

fn ass_color(hex: &str, alpha: u8) -> String {
    let h = hex.trim_start_matches('#');
    let (r, g, b) = if h.len() >= 6 {
        (
            u8::from_str_radix(&h[0..2], 16).unwrap_or(255),
            u8::from_str_radix(&h[2..4], 16).unwrap_or(255),
            u8::from_str_radix(&h[4..6], 16).unwrap_or(255),
        )
    } else {
        (255, 255, 255)
    };
    format!("&H{alpha:02X}{b:02X}{g:02X}{r:02X}")
}

fn ass_time(t: f64) -> String {
    let cs = (t.max(0.0) * 100.0).round() as u64;
    let h = cs / 360_000;
    let m = (cs / 6000) % 60;
    let s = (cs / 100) % 60;
    let c = cs % 100;
    format!("{h}:{m:02}:{s:02}.{c:02}")
}

fn ass_escape(t: &str) -> String {
    t.replace('\\', "/")
        .replace('{', "(")
        .replace('}', ")")
        .replace("\r\n", "\\N")
        .replace('\n', "\\N")
}

pub fn build_ass(subs: &RSubtitles, w: u32, h: u32) -> String {
    let st = &subs.style;
    let scale = h as f64 / 1080.0;
    let size = (st.font_size * scale).round().max(8.0);
    let outline = (st.outline_width * scale).max(0.0);
    let shadow = if st.shadow { (3.0 * scale).max(1.0) } else { 0.0 };
    let (align, margin_v) = match st.position.as_str() {
        "top" => (8, (h as f64 * 0.10).round()),
        "middle" => (5, 0.0),
        _ => (2, (h as f64 * 0.12).round()),
    };
    let bold = if st.bold.unwrap_or(true) { -1 } else { 0 };
    let primary = ass_color(&st.color, 0);
    let secondary = if st.animation == "word" { ass_color(&st.color, 0xFF) } else { ass_color(&st.color, 0) };
    let outline_c = ass_color(&st.outline_color, 0);
    let back = "&H80000000";
    let font = st.font_family.replace(',', " ");
    let margin_lr = (w as f64 * 0.06).round();

    let mut out = String::new();
    let _ = write!(
        out,
        "[Script Info]\nScriptType: v4.00+\nPlayResX: {w}\nPlayResY: {h}\nWrapStyle: 0\nScaledBorderAndShadow: yes\n\n\
         [V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n\
         Style: Default,{font},{size},{primary},{secondary},{outline_c},{back},{bold},0,0,0,100,100,0,0,1,{:.1},{:.1},{align},{margin_lr},{margin_lr},{margin_v},1\n\n\
         [Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n",
        outline, shadow
    );

    for c in &subs.cues {
        if c.end <= c.start || c.text.trim().is_empty() {
            continue;
        }
        let mut text = c.text.trim().to_string();
        if st.uppercase.unwrap_or(false) {
            text = text.to_uppercase();
        }
        let body = match st.animation.as_str() {
            "fade" => format!("{{\\fad(180,120)}}{}", ass_escape(&text)),
            "pop" => format!(
                "{{\\fscx70\\fscy70\\t(0,140,\\fscx108\\fscy108)\\t(140,240,\\fscx100\\fscy100)}}{}",
                ass_escape(&text)
            ),
            "word" => {
                let words: Vec<&str> = text.split_whitespace().collect();
                let total_chars: usize = words.iter().map(|w| w.chars().count().max(1)).sum();
                let dur_cs = ((c.end - c.start) * 100.0 * 0.85).max(1.0);
                let mut s = String::new();
                for (i, word) in words.iter().enumerate() {
                    let k = ((word.chars().count().max(1) as f64 / total_chars as f64) * dur_cs).round() as u64;
                    let _ = write!(s, "{{\\ko{}}}{}", k.max(1), ass_escape(word));
                    if i + 1 < words.len() {
                        s.push(' ');
                    }
                }
                s
            }
            _ => ass_escape(&text),
        };
        let _ = writeln!(out, "Dialogue: 0,{},{},Default,,0,0,0,,{}", ass_time(c.start), ass_time(c.end), body);
    }
    out
}

/// SRT для внешнего использования (экспорт субтитров отдельным файлом).
pub fn build_srt(cues: &[RCue]) -> String {
    fn t(v: f64) -> String {
        let ms = (v.max(0.0) * 1000.0).round() as u64;
        format!("{:02}:{:02}:{:02},{:03}", ms / 3_600_000, (ms / 60_000) % 60, (ms / 1000) % 60, ms % 1000)
    }
    let mut out = String::new();
    for (i, c) in cues.iter().filter(|c| c.end > c.start && !c.text.trim().is_empty()).enumerate() {
        let _ = write!(out, "{}\n{} --> {}\n{}\n\n", i + 1, t(c.start), t(c.end), c.text.trim());
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spec() -> RenderSpec {
        RenderSpec {
            clips: vec![],
            audio: vec![],
            overlays: vec![],
            subtitles: None,
            width: 1080,
            height: 1920,
            fps: 30.0,
            fit: "crop".into(),
            master_volume: 1.0,
        }
    }

    #[test]
    fn colors() {
        assert_eq!(ass_color("#FF0000", 0), "&H000000FF");
        assert_eq!(ass_color("#00C2FF", 0xFF), "&HFFFFC200");
    }

    #[test]
    fn time() {
        assert_eq!(ass_time(3661.256), "1:01:01.26");
    }

    #[test]
    fn empty_rejected() {
        assert!(spec().validate().is_err());
    }
}
