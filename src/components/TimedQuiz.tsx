"use client";

import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Image from "next/image";
import {
  quizImages,
  type QuizAnswer,
  type QuizImage,
} from "@/data/quiz-images.generated";

const ROUND_SIZE = 10;
const SECONDS_PER_IMAGE = 10;
const FEEDBACK_MS = 900;
const LEADERBOARD_KEY = "leviosa-turing-test-leaderboard-v1";
const MAX_LEADERBOARD_ENTRIES = 12;

type Phase = "booting" | "intro" | "question" | "feedback" | "finished";
type PreloadStatus = "idle" | "loading" | "ready";

type Stats = {
  correct: number;
  wrong: number;
  timedOut: number;
};

type Feedback = {
  choice: QuizAnswer | null;
  correct: boolean;
  timedOut: boolean;
  answer: QuizAnswer;
};

type LeaderboardEntry = {
  id: string;
  name: string;
  correct: number;
  wrong: number;
  timedOut: number;
  total: number;
  accuracy: number;
  totalTimeMs: number;
  createdAt: string;
};

const answerLabels: Record<QuizAnswer, string> = {
  ai: "AI",
  human: "사람",
};

function shuffleImages(images: QuizImage[]) {
  const next = [...images];

  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }

  return next;
}

function createRound() {
  return shuffleImages(quizImages).slice(0, ROUND_SIZE);
}

function verdictForScore(correct: number, total: number) {
  if (total === 0) {
    return "이미지를 먼저 추가해 주세요.";
  }

  const accuracy = correct / total;

  if (accuracy >= 0.8) {
    return "눈썰미가 좋네요.";
  }

  if (accuracy >= 0.5) {
    return "반반입니다.";
  }

  return "AI가 꽤 잘 속였어요.";
}

function sortLeaderboard(entries: LeaderboardEntry[]) {
  return [...entries].sort((a, b) => {
    if (a.correct !== b.correct) {
      return b.correct - a.correct;
    }

    const aPerfect = a.correct === a.total;
    const bPerfect = b.correct === b.total;

    if (aPerfect && bPerfect && a.totalTimeMs !== b.totalTimeMs) {
      return a.totalTimeMs - b.totalTimeMs;
    }

    if (a.accuracy !== b.accuracy) {
      return b.accuracy - a.accuracy;
    }

    return a.totalTimeMs - b.totalTimeMs;
  });
}

function isLeaderboardEntry(value: unknown): value is LeaderboardEntry {
  if (!value || typeof value !== "object") {
    return false;
  }

  const entry = value as Partial<LeaderboardEntry>;

  return (
    typeof entry.id === "string" &&
    typeof entry.name === "string" &&
    typeof entry.correct === "number" &&
    typeof entry.wrong === "number" &&
    typeof entry.timedOut === "number" &&
    typeof entry.total === "number" &&
    typeof entry.accuracy === "number" &&
    typeof entry.totalTimeMs === "number" &&
    typeof entry.createdAt === "string"
  );
}

function readLeaderboard() {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(LEADERBOARD_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];

    return Array.isArray(parsed)
      ? sortLeaderboard(parsed.filter(isLeaderboardEntry)).slice(
          0,
          MAX_LEADERBOARD_ENTRIES,
        )
      : [];
  } catch {
    return [];
  }
}

function saveLeaderboardEntry(entry: LeaderboardEntry) {
  const nextEntries = sortLeaderboard([...readLeaderboard(), entry]).slice(
    0,
    MAX_LEADERBOARD_ENTRIES,
  );

  window.localStorage.setItem(LEADERBOARD_KEY, JSON.stringify(nextEntries));

  return nextEntries;
}

function createEntryId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatSeconds(milliseconds: number) {
  return `${(milliseconds / 1000).toFixed(1)}초`;
}

function initialsForName(name: string) {
  const trimmed = name.trim();

  if (!trimmed) {
    return "?";
  }

  return trimmed.slice(0, 2).toUpperCase();
}

function avatarBackgroundForName(name: string) {
  const hue = [...name].reduce(
    (total, character) => total + character.charCodeAt(0),
    0,
  );
  const firstHue = hue % 360;
  const secondHue = (firstHue + 42) % 360;

  return {
    background: `linear-gradient(135deg, hsl(${firstHue} 74% 58%), hsl(${secondHue} 78% 42%))`,
  };
}

export function TimedQuiz() {
  const aiImageCount = quizImages.filter((image) => image.answer === "ai").length;
  const humanImageCount = quizImages.filter(
    (image) => image.answer === "human",
  ).length;
  const hasBothAnswerTypes = aiImageCount > 0 && humanImageCount > 0;
  const [phase, setPhase] = useState<Phase>("booting");
  const [pendingRound, setPendingRound] = useState<QuizImage[]>([]);
  const [preloadStatus, setPreloadStatus] = useState<PreloadStatus>("idle");
  const [preloadedCount, setPreloadedCount] = useState(0);
  const [round, setRound] = useState<QuizImage[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(SECONDS_PER_IMAGE);
  const [stats, setStats] = useState<Stats>({
    correct: 0,
    wrong: 0,
    timedOut: 0,
  });
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [selectedAnswer, setSelectedAnswer] = useState<QuizAnswer | null>(null);
  const [nameInput, setNameInput] = useState("");
  const [playerName, setPlayerName] = useState("");
  const [questionStartedAt, setQuestionStartedAt] = useState<number | null>(null);
  const [totalTimeMs, setTotalTimeMs] = useState(0);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const savedResultIdRef = useRef<string | null>(null);

  const currentImage = round[currentIndex];
  const totalImages = round.length;
  const progressPercent = totalImages
    ? ((currentIndex + (phase === "finished" ? 1 : 0)) / totalImages) * 100
    : 0;
  const timerPercent = (secondsLeft / SECONDS_PER_IMAGE) * 100;
  const isRoundReady = preloadStatus === "ready" && pendingRound.length > 0;

  const prepareNextRound = useCallback(() => {
    if (!hasBothAnswerTypes) {
      setPendingRound([]);
      setPreloadStatus("idle");
      setPreloadedCount(0);
      return;
    }

    setPreloadStatus("loading");
    setPreloadedCount(0);
    setPendingRound(createRound());
  }, [hasBothAnswerTypes]);

  useEffect(() => {
    if (pendingRound.length === 0) {
      return;
    }

    let cancelled = false;

    Promise.all(
      pendingRound.map(
        (image) =>
          new Promise<void>((resolve) => {
            const preloadImage = new window.Image();

            preloadImage.onload = () => resolve();
            preloadImage.onerror = () => resolve();
            preloadImage.src = image.src;
          }).then(() => {
            if (!cancelled) {
              setPreloadedCount((count) => count + 1);
            }
          }),
      ),
    ).then(() => {
      if (!cancelled) {
        setPreloadStatus("ready");
      }
    });

    return () => {
      cancelled = true;
    };
  }, [pendingRound]);

  const startRound = useCallback(() => {
    if (!hasBothAnswerTypes) {
      setRound([]);
      setCurrentIndex(0);
      setSecondsLeft(SECONDS_PER_IMAGE);
      setStats({ correct: 0, wrong: 0, timedOut: 0 });
      setFeedback(null);
      setSelectedAnswer(null);
      setQuestionStartedAt(null);
      setTotalTimeMs(0);
      setPhase("finished");
      return;
    }

    const nextRound = pendingRound.length > 0 ? pendingRound : createRound();

    setRound(nextRound);
    setCurrentIndex(0);
    setSecondsLeft(SECONDS_PER_IMAGE);
    setStats({ correct: 0, wrong: 0, timedOut: 0 });
    setFeedback(null);
    setSelectedAnswer(null);
    setQuestionStartedAt(Date.now());
    setTotalTimeMs(0);
    savedResultIdRef.current = null;
    setPendingRound([]);
    setPreloadStatus("idle");
    setPreloadedCount(0);
    setPhase(nextRound.length > 0 ? "question" : "finished");
  }, [hasBothAnswerTypes, pendingRound]);

  useEffect(() => {
    const bootId = window.setTimeout(() => {
      setLeaderboard(readLeaderboard());
      setPhase(hasBothAnswerTypes ? "intro" : "finished");

      if (hasBothAnswerTypes) {
        prepareNextRound();
      }
    }, 0);

    return () => window.clearTimeout(bootId);
  }, [hasBothAnswerTypes, prepareNextRound]);

  const handleStartSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      const nextName = nameInput.trim().slice(0, 24);

      if (!nextName || !isRoundReady) {
        return;
      }

      setPlayerName(nextName);
      startRound();
    },
    [nameInput, isRoundReady, startRound],
  );

  const returnToIntro = useCallback(() => {
    setRound([]);
    setCurrentIndex(0);
    setSecondsLeft(SECONDS_PER_IMAGE);
    setStats({ correct: 0, wrong: 0, timedOut: 0 });
    setFeedback(null);
    setSelectedAnswer(null);
    setQuestionStartedAt(null);
    setTotalTimeMs(0);
    setPlayerName("");
    setNameInput("");
    savedResultIdRef.current = null;
    prepareNextRound();
    setPhase("intro");
  }, [prepareNextRound]);

  const finishQuestion = useCallback(
    (choice: QuizAnswer | null, timedOut = false) => {
      if (!currentImage || phase !== "question") {
        return;
      }

      const isCorrect = choice === currentImage.answer;
      const elapsedMs =
        timedOut || questionStartedAt === null
          ? SECONDS_PER_IMAGE * 1000
          : Math.min(
              SECONDS_PER_IMAGE * 1000,
              Math.max(0, Date.now() - questionStartedAt),
            );

      setSelectedAnswer(choice);
      setTotalTimeMs((previous) => previous + elapsedMs);
      setStats((previous) => ({
        correct: previous.correct + (isCorrect ? 1 : 0),
        wrong: previous.wrong + (isCorrect ? 0 : 1),
        timedOut: previous.timedOut + (timedOut ? 1 : 0),
      }));

      setFeedback({
        choice,
        correct: isCorrect,
        timedOut,
        answer: currentImage.answer,
      });
      setPhase("feedback");
    },
    [currentImage, phase, questionStartedAt],
  );

  useEffect(() => {
    if (phase !== "question") {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.repeat) {
        return;
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        finishQuestion("ai");
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        finishQuestion("human");
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [finishQuestion, phase]);

  useEffect(() => {
    if (phase !== "question" || !currentImage) {
      return;
    }

    const timerId = window.setTimeout(() => {
      if (secondsLeft <= 1) {
        setSecondsLeft(0);
        finishQuestion(null, true);
        return;
      }

      setSecondsLeft(secondsLeft - 1);
    }, 1000);

    return () => window.clearTimeout(timerId);
  }, [currentImage, finishQuestion, phase, secondsLeft]);

  useEffect(() => {
    if (phase !== "feedback") {
      return;
    }

    const feedbackId = window.setTimeout(() => {
      const nextIndex = currentIndex + 1;

      if (nextIndex >= totalImages) {
        setPhase("finished");
        return;
      }

      setCurrentIndex(nextIndex);
      setSecondsLeft(SECONDS_PER_IMAGE);
      setFeedback(null);
      setSelectedAnswer(null);
      setQuestionStartedAt(Date.now());
      setPhase("question");
    }, FEEDBACK_MS);

    return () => window.clearTimeout(feedbackId);
  }, [currentIndex, phase, totalImages]);

  useEffect(() => {
    if (
      phase !== "finished" ||
      !hasBothAnswerTypes ||
      totalImages === 0 ||
      !playerName ||
      savedResultIdRef.current
    ) {
      return;
    }

    const entry: LeaderboardEntry = {
      id: createEntryId(),
      name: playerName,
      correct: stats.correct,
      wrong: stats.wrong,
      timedOut: stats.timedOut,
      total: totalImages,
      accuracy: Math.round((stats.correct / totalImages) * 100),
      totalTimeMs,
      createdAt: new Date().toISOString(),
    };

    savedResultIdRef.current = entry.id;
    setLeaderboard(saveLeaderboardEntry(entry));
  }, [
    hasBothAnswerTypes,
    phase,
    playerName,
    stats.correct,
    stats.timedOut,
    stats.wrong,
    totalImages,
    totalTimeMs,
  ]);

  const finalVerdict = useMemo(
    () => verdictForScore(stats.correct, totalImages),
    [stats.correct, totalImages],
  );

  const accuracy = totalImages
    ? Math.round((stats.correct / totalImages) * 100)
    : 0;
  const timerRingColor = secondsLeft <= 3 ? "#ff4d6d" : "#ffffff";

  if (phase === "booting") {
    return (
      <main className="relative grid h-[100dvh] place-items-center overflow-hidden px-5 py-8">
        <div className="text-sm font-semibold text-[var(--muted)]">
          테스트 준비 중
        </div>
      </main>
    );
  }

  if (!hasBothAnswerTypes) {
    return (
      <main className="relative h-[100dvh] overflow-hidden px-4 py-4 sm:px-6">
        <div className="noise-layer pointer-events-none fixed inset-0 opacity-80" />
        <section className="mx-auto flex h-full w-full max-w-3xl items-center justify-center">
          <div className="w-full rounded-[1.5rem] bg-black/5 p-1.5 shadow-[0_28px_70px_-42px_rgba(0,0,0,0.45)] ring-1 ring-black/10 sm:rounded-[2rem] sm:p-2">
            <div className="rounded-[calc(1.5rem-0.375rem)] bg-[var(--panel)] p-5 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.85)] sm:rounded-[calc(2rem-0.5rem)] sm:p-8">
              <p className="text-xs font-bold uppercase tracking-[0.24em] text-[var(--accent)]">
                Leviosa Turing Test
              </p>
              <h1 className="mt-4 text-3xl font-black leading-tight tracking-normal sm:text-5xl">
                이미지 구성이 필요합니다
              </h1>
              <p className="mx-auto mt-4 max-w-xl text-sm leading-6 text-[var(--muted)] sm:text-base sm:leading-7">
                AI 이미지는 <span className="font-bold text-black">public/ai</span>,
                사람 이미지는{" "}
                <span className="font-bold text-black">public/human</span> 폴더에
                넣고 다시 실행해 주세요.
              </p>
              <div className="mx-auto mt-5 grid max-w-sm grid-cols-2 gap-3 text-center sm:mt-7">
                <ScoreCell label="AI 이미지" value={aiImageCount} tone="success" />
                <ScoreCell
                  label="사람 이미지"
                  value={humanImageCount}
                  tone="warning"
                />
              </div>
            </div>
          </div>
        </section>
      </main>
    );
  }

  if (phase === "intro") {
    return (
      <IntroScreen
        leaderboard={leaderboard}
        nameInput={nameInput}
        preloadStatus={preloadStatus}
        preloadedCount={preloadedCount}
        totalPreloadCount={pendingRound.length}
        onNameChange={setNameInput}
        onSubmit={handleStartSubmit}
      />
    );
  }

  return (
    <main className="relative h-[100dvh] max-h-[100dvh] overflow-hidden bg-black text-white">
      <div className="noise-layer pointer-events-none fixed inset-0 z-20 opacity-35" />
      <section className="relative h-full min-h-0 w-full overflow-hidden bg-[#080808]">
        {currentImage && (
          <Image
            key={currentImage.id}
            src={currentImage.src}
            alt="AI인지 사람인지 맞혀야 하는 테스트 이미지"
            fill
            priority
            unoptimized
            sizes="100vw"
            className="object-cover"
            draggable={false}
          />
        )}

        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.58)_0%,rgba(0,0,0,0.16)_28%,rgba(0,0,0,0.08)_48%,rgba(0,0,0,0.86)_100%)]" />
        <div className="absolute inset-x-0 top-0 z-10 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-6 sm:pt-5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[0.68rem] font-black uppercase tracking-[0.22em] text-white/72">
              Leviosa Turing Test
            </p>
            <div className="rounded-full bg-black/48 px-3 py-1 text-sm font-black text-white ring-1 ring-white/12 backdrop-blur-md">
              {Math.min(currentIndex + 1, totalImages)} / {totalImages}
            </div>
          </div>

          <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/20">
            <div
              className="h-full rounded-full bg-white transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>

        <div className="absolute right-4 top-32 z-10 sm:right-6 sm:top-36">
          <div
            className="grid h-20 w-20 place-items-center rounded-full p-[5px] shadow-[0_22px_55px_-32px_rgba(0,0,0,0.95)] transition duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] sm:h-24 sm:w-24"
            style={{
              background: `conic-gradient(from -90deg, ${timerRingColor} 0% ${timerPercent}%, rgba(255,255,255,0.18) ${timerPercent}% 100%)`,
            }}
          >
            <div
              className={`flex h-full w-full items-center justify-center rounded-full border text-3xl font-black leading-none text-white ring-1 ring-white/10 backdrop-blur-md transition duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] sm:text-4xl ${
                secondsLeft <= 3
                  ? "border-[#ff4d6d]/36 bg-[#ff2d55]/72"
                  : "border-white/14 bg-black/58"
              }`}
            >
              <span className="translate-y-[1px]">{secondsLeft}</span>
            </div>
          </div>
        </div>

        <StatRail
          correct={stats.correct}
          timedOut={stats.timedOut}
          wrong={stats.wrong}
        />

        {phase === "feedback" && feedback && (
          <div className="absolute inset-0 z-20 grid place-items-center bg-black/16 px-5 text-center text-white backdrop-blur-[3px]">
            <FeedbackCard feedback={feedback} />
          </div>
        )}

        <div className="absolute inset-x-0 bottom-0 z-10 px-4 pb-[max(0.85rem,env(safe-area-inset-bottom))] sm:px-6 sm:pb-6">
          <div className="max-w-3xl">
            <p className="text-[0.7rem] font-black uppercase tracking-[0.2em] text-white/64">
              10초 안에 선택
            </p>
            <h1 className="mt-2 max-w-xl text-4xl font-black leading-[0.98] tracking-normal sm:text-6xl lg:text-7xl">
              AI일까요, 사람일까요?
            </h1>
          </div>

          {phase !== "finished" ? (
            <div className="mt-5 flex items-center justify-center gap-5 sm:gap-7">
              <ChoiceButton
                disabled={phase !== "question"}
                label="AI"
                selected={selectedAnswer === "ai"}
                tone="danger"
                onClick={() => finishQuestion("ai")}
              />
              <ChoiceButton
                disabled={phase !== "question"}
                label="사람"
                selected={selectedAnswer === "human"}
                tone="success"
                onClick={() => finishQuestion("human")}
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={returnToIntro}
              className="mt-5 rounded-full bg-white px-8 py-4 text-base font-black text-black shadow-[0_20px_50px_-30px_rgba(255,255,255,0.95)] transition duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.98]"
            >
              다음 참가자
            </button>
          )}
        </div>

        {phase === "finished" && (
          <div className="absolute inset-0 z-20 bg-black/82 px-3 py-3 backdrop-blur-md">
            <div className="mx-auto grid h-full w-full max-w-md grid-rows-[auto_minmax(0,1fr)] gap-3">
              <div className="rounded-[2rem] border border-white/12 bg-[#171717]/92 p-4 shadow-[0_30px_90px_-54px_rgba(0,0,0,0.95)]">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-black uppercase tracking-[0.2em] text-white/46">
                      {playerName || "Guest"} 결과
                    </p>
                    <h2 className="mt-2 text-5xl font-black leading-none tracking-normal">
                      {accuracy}점
                    </h2>
                    <p className="mt-2 text-base font-black text-white/82">
                      {finalVerdict}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={returnToIntro}
                    className="shrink-0 rounded-full bg-white px-4 py-2 text-sm font-black text-black transition duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.98]"
                  >
                    다음
                  </button>
                </div>

                <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                  <ResultMetric label="정답" value={`${stats.correct}`} />
                  <ResultMetric label="시간" value={formatSeconds(totalTimeMs)} />
                  <ResultMetric label="초과" value={`${stats.timedOut}`} />
                </div>
              </div>

              <LeaderboardList entries={leaderboard} />
            </div>
          </div>
        )}
      </section>
    </main>
  );
}

function IntroScreen({
  leaderboard,
  nameInput,
  preloadStatus,
  preloadedCount,
  totalPreloadCount,
  onNameChange,
  onSubmit,
}: {
  leaderboard: LeaderboardEntry[];
  nameInput: string;
  preloadStatus: PreloadStatus;
  preloadedCount: number;
  totalPreloadCount: number;
  onNameChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const isReady = preloadStatus === "ready" && totalPreloadCount > 0;
  const canStart = nameInput.trim().length > 0 && isReady;
  const preloadLabel = isReady
    ? "READY"
    : `${preloadedCount}/${totalPreloadCount || ROUND_SIZE}`;
  const preloadProgress = isReady
    ? 100
    : Math.round((preloadedCount / (totalPreloadCount || ROUND_SIZE)) * 100);

  return (
    <main className="relative h-[100dvh] max-h-[100dvh] overflow-hidden bg-[#030504] px-3 py-3 text-white">
      <div className="noise-layer pointer-events-none fixed inset-0 z-20 opacity-45" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_8%_12%,rgba(18,216,137,0.28),transparent_17rem),radial-gradient(circle_at_93%_8%,rgba(154,255,36,0.14),transparent_14rem),radial-gradient(circle_at_86%_42%,rgba(255,77,109,0.11),transparent_18rem),linear-gradient(155deg,#101312_0%,#060807_46%,#020202_100%)]" />
      <div className="pointer-events-none absolute inset-x-8 top-0 h-36 rounded-full bg-[#12d889]/15 blur-3xl" />
      <section className="relative z-10 mx-auto grid h-full w-full max-w-md grid-rows-[auto_minmax(0,1fr)] gap-3">
        <form
          onSubmit={onSubmit}
          className="relative overflow-hidden rounded-[2rem] border border-white/12 bg-white/[0.075] p-1 shadow-[0_28px_80px_-42px_rgba(18,216,137,0.7)] backdrop-blur-2xl"
        >
          <div className="absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-white/50 to-transparent" />
          <div className="rounded-[calc(2rem-0.25rem)] border border-white/[0.06] bg-[#0b0d0c]/88 px-4 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="inline-flex items-center gap-2 rounded-full border border-[#12d889]/22 bg-[#12d889]/10 px-3 py-1 text-[0.62rem] font-black uppercase tracking-[0.22em] text-[#91ffd8]">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#9aff24] shadow-[0_0_14px_rgba(154,255,36,0.85)]" />
                  Leviosa Turing Test
                </div>
                <h1 className="mt-3 text-[2.1rem] font-black leading-[0.96] tracking-[-0.045em] text-white sm:text-4xl">
                  이름을 입력하고
                  <span className="block bg-gradient-to-r from-white via-[#d8fff2] to-[#8affca] bg-clip-text text-transparent">
                    감별을 시작하세요
                  </span>
                </h1>
              </div>
              <div className="shrink-0 rounded-[1.15rem] border border-white/10 bg-white/[0.06] px-3 py-2 text-right">
                <p className="text-[0.58rem] font-black uppercase tracking-[0.18em] text-white/38">
                  Round
                </p>
                <p className="mt-0.5 text-lg font-black leading-none text-white">
                  {ROUND_SIZE}
                </p>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-[minmax(0,1fr)_auto] gap-2 rounded-[1.35rem] border border-white/10 bg-black/45 p-1.5 shadow-[inset_0_1px_18px_rgba(0,0,0,0.35)]">
              <label className="sr-only" htmlFor="player-name">
                이름
              </label>
              <input
                id="player-name"
                autoFocus
                maxLength={24}
                value={nameInput}
                onChange={(event) => onNameChange(event.target.value)}
                placeholder="이름"
                className="h-14 min-w-0 rounded-[1.05rem] bg-transparent px-4 text-xl font-black text-white outline-none transition duration-300 placeholder:text-white/24 focus:bg-white/[0.035]"
              />
              <button
                type="submit"
                disabled={!canStart}
                className="group relative h-14 shrink-0 overflow-hidden rounded-[1.05rem] bg-white px-5 text-base font-black text-black shadow-[0_14px_32px_-18px_rgba(255,255,255,0.85)] transition duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.98] disabled:pointer-events-none disabled:bg-white/28 disabled:text-white/38 disabled:shadow-none"
              >
                <span className="absolute inset-0 translate-x-[-120%] bg-gradient-to-r from-transparent via-[#9aff24]/65 to-transparent transition duration-700 group-hover:translate-x-[120%]" />
                <span className="relative">{isReady ? "시작" : "준비"}</span>
              </button>
            </div>

            <div className="mt-3 flex items-center gap-3 text-[0.68rem] font-black text-white/45">
              <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-[#12d889] to-[#9aff24] transition-all duration-500"
                  style={{ width: `${Math.min(100, preloadProgress)}%` }}
                />
              </div>
              <span className="shrink-0 tracking-[0.12em] text-white/55">
                {preloadLabel}
              </span>
            </div>
          </div>
        </form>

        <LeaderboardList entries={leaderboard} />
      </section>
    </main>
  );
}

function LeaderboardList({ entries }: { entries: LeaderboardEntry[] }) {
  const topEntries = entries.slice(0, 5);
  const perfectCount = entries.filter((entry) => entry.accuracy === 100).length;
  const bestScore = topEntries[0]?.accuracy ?? 0;
  const fastestPerfect = entries.find((entry) => entry.accuracy === 100);

  return (
    <div className="relative flex min-h-0 w-full flex-col overflow-hidden rounded-[2rem] border border-white/12 bg-white/[0.07] p-1 shadow-[0_30px_90px_-52px_rgba(0,0,0,0.95)] backdrop-blur-2xl">
      <div className="absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-[#9aff24]/70 to-transparent" />
      <div className="flex min-h-0 flex-1 flex-col rounded-[calc(2rem-0.25rem)] border border-white/[0.06] bg-[#090b0a]/88 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[0.68rem] font-black uppercase tracking-[0.22em] text-[#91ffd8]/70">
              Leaderboard
            </p>
            <h2 className="mt-1 text-[1.72rem] font-black leading-none tracking-[-0.035em] text-white">
              TOP 참가자
            </h2>
          </div>
          <div className="rounded-full border border-white/10 bg-white/[0.06] px-3 py-2 text-right text-[0.62rem] font-black leading-none text-white/42">
            정답순 · 시간순
          </div>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2">
          <LeaderboardStatPill label="기록" value={`${entries.length}`} />
          <LeaderboardStatPill label="최고점" value={`${bestScore}`} tone="bright" />
          <LeaderboardStatPill
            label="100점"
            value={perfectCount ? `${perfectCount}` : "—"}
          />
        </div>

        {topEntries.length > 0 ? (
          <div className="mt-4 min-h-0 flex-1 space-y-2.5 overflow-hidden">
            {topEntries.map((entry, index) => {
              const isChampion = index === 0;
              const scoreWidth = Math.max(8, entry.accuracy);

              return (
                <div
                  key={entry.id}
                  className={`relative grid min-h-[5.25rem] grid-cols-[1.55rem_3.25rem_minmax(0,1fr)_3rem] items-center gap-3 overflow-hidden rounded-[1.45rem] px-3.5 py-3 ring-1 transition duration-300 ${
                    isChampion
                      ? "bg-gradient-to-r from-[#13251d] via-white/[0.075] to-[#191f13] ring-[#9aff24]/22 shadow-[0_18px_55px_-32px_rgba(154,255,36,0.9)]"
                      : "bg-white/[0.052] ring-white/[0.07]"
                  }`}
                >
                  <div className="absolute inset-x-0 bottom-0 h-1 bg-white/[0.045]">
                    <div
                      className="h-full bg-gradient-to-r from-[#12d889] to-[#9aff24] opacity-80"
                      style={{ width: `${scoreWidth}%` }}
                    />
                  </div>
                  <div
                    className={`text-center text-lg font-black leading-none ${
                      isChampion ? "text-[#9aff24]" : "text-white/68"
                    }`}
                  >
                    {index + 1}
                  </div>
                  <div
                    className="relative grid h-[3.25rem] w-[3.25rem] place-items-center rounded-[1.05rem] text-lg font-black text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.24),0_16px_34px_-22px_rgba(18,216,137,0.9)]"
                    style={avatarBackgroundForName(entry.name)}
                  >
                    <span className="absolute inset-0 rounded-[1.05rem] bg-white/[0.08]" />
                    <span className="relative">{initialsForName(entry.name)}</span>
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-xl font-black leading-none tracking-[-0.03em] text-white">
                        {entry.name}
                      </p>
                      {isChampion && (
                        <span className="rounded-full bg-[#9aff24] px-2 py-0.5 text-[0.55rem] font-black text-black">
                          #1
                        </span>
                      )}
                    </div>
                    <p className="mt-1.5 truncate text-sm font-bold leading-none text-white/45">
                      {entry.correct}/{entry.total} 정답 ·{" "}
                      {formatSeconds(entry.totalTimeMs)}
                    </p>
                  </div>
                  <div className="flex min-w-0 flex-col items-end">
                    <p className="text-2xl font-black leading-none tracking-[-0.04em] text-white">
                      {entry.accuracy}
                    </p>
                    <p className="mt-0.5 text-[0.65rem] font-black leading-none text-white/38">
                      점
                    </p>
                    {entry.id === fastestPerfect?.id && (
                      <div className="mt-1 rounded-full bg-[#9aff24] px-2 py-0.5 text-[0.58rem] font-black text-black">
                        FAST
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="mt-4 grid min-h-0 flex-1 place-items-center rounded-[1.55rem] border border-dashed border-white/12 bg-white/[0.045] px-5 text-center">
            <div>
              <p className="text-2xl font-black text-white/72">첫 기록을 기다리는 중</p>
              <p className="mt-2 text-sm font-bold text-white/38">
                이름을 입력하고 라운드를 시작하면 여기에 순위가 표시됩니다.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function LeaderboardStatPill({
  label,
  value,
  tone = "muted",
}: {
  label: string;
  value: string;
  tone?: "muted" | "bright";
}) {
  return (
    <div
      className={`rounded-[1rem] border px-3 py-2.5 ${
        tone === "bright"
          ? "border-[#9aff24]/20 bg-[#9aff24]/10"
          : "border-white/10 bg-white/[0.045]"
      }`}
    >
      <p className="text-[0.6rem] font-black uppercase tracking-[0.16em] text-white/35">
        {label}
      </p>
      <p className="mt-1 text-lg font-black leading-none text-white">{value}</p>
    </div>
  );
}

function ResultMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[1.2rem] bg-black/42 px-3 py-3 ring-1 ring-white/10">
      <p className="truncate text-base font-black text-white">{value}</p>
      <p className="mt-1 text-[0.66rem] font-black text-white/52">{label}</p>
    </div>
  );
}

function StatRail({
  correct,
  timedOut,
  wrong,
}: {
  correct: number;
  timedOut: number;
  wrong: number;
}) {
  return (
    <div className="absolute right-4 top-1/2 z-10 flex -translate-y-1/2 flex-col items-center gap-3 sm:right-6">
      <SideStat label="정답" tone="success" value={correct} />
      <SideStat label="오답" tone="danger" value={wrong} />
      <SideStat label="시간초과" tone="warning" value={timedOut} />
    </div>
  );
}

function FeedbackCard({ feedback }: { feedback: Feedback }) {
  const state = feedback.timedOut
    ? "timeout"
    : feedback.correct
      ? "correct"
      : "wrong";
  const statusLabel = {
    correct: "정답",
    wrong: "오답",
    timeout: "시간 초과",
  }[state];
  const title = {
    correct: "맞혔습니다",
    wrong: "아쉽습니다",
    timeout: "시간이 끝났습니다",
  }[state];
  const accentClass = {
    correct:
      "border-[#12d889]/38 shadow-[0_0_50px_rgba(18,216,137,0.18)] text-[#12d889]",
    wrong:
      "border-[#ff4d6d]/38 shadow-[0_0_50px_rgba(255,77,109,0.18)] text-[#ff4d6d]",
    timeout:
      "border-[#f6b73c]/38 shadow-[0_0_50px_rgba(246,183,60,0.16)] text-[#f6b73c]",
  }[state];
  const accentTextClass = {
    correct: "text-[#12d889]",
    wrong: "text-[#ff4d6d]",
    timeout: "text-[#f6b73c]",
  }[state];

  return (
    <div
      className={`w-full max-w-[31rem] rounded-[2.25rem] border bg-black/54 p-1.5 backdrop-blur-2xl ${accentClass}`}
    >
      <div className="rounded-[calc(2.25rem-0.375rem)] border border-white/10 bg-white/[0.06] px-6 py-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] sm:px-8 sm:py-7">
        <div className="mx-auto inline-flex h-9 items-center justify-center rounded-full bg-black/42 px-4 text-[0.72rem] font-black uppercase tracking-[0.22em] text-white/74 ring-1 ring-white/12">
          {statusLabel}
        </div>
        <p className="mt-4 text-4xl font-black leading-none tracking-normal text-white sm:text-5xl">
          {title}
        </p>
        <div className="mx-auto mt-5 h-px w-20 bg-white/18" />
        <p className="mt-5 text-base font-black text-white/84">
          정답은{" "}
          <span className={accentTextClass}>{answerLabels[feedback.answer]}</span>
        </p>
      </div>
    </div>
  );
}

function SideStat({
  label,
  tone,
  value,
}: {
  label: string;
  tone: "success" | "danger" | "warning";
  value: number;
}) {
  const toneClass = {
    success: "text-[#12d889] shadow-[0_0_28px_rgba(18,216,137,0.24)]",
    danger: "text-[#ff4d6d] shadow-[0_0_28px_rgba(255,77,109,0.24)]",
    warning: "text-[#f6b73c] shadow-[0_0_28px_rgba(246,183,60,0.22)]",
  }[tone];

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div
        className={`relative h-14 w-14 shrink-0 rounded-full border border-white/14 bg-black/58 ring-1 ring-white/10 backdrop-blur-md ${toneClass}`}
      >
        <span className="absolute left-1/2 top-1/2 block -translate-x-1/2 -translate-y-1/2 font-mono text-2xl font-black leading-none tabular-nums">
          {value}
        </span>
      </div>
      <div className="flex h-7 min-w-12 max-w-[4.75rem] items-center justify-center rounded-full bg-black/42 px-2.5 text-center text-[0.68rem] font-black leading-none text-white/82 ring-1 ring-white/10 backdrop-blur-md">
        <span className="block translate-y-[1px] leading-none">{label}</span>
      </div>
    </div>
  );
}

function ChoiceButton({
  disabled,
  label,
  selected,
  tone,
  onClick,
}: {
  disabled: boolean;
  label: string;
  selected: boolean;
  tone: "danger" | "success";
  onClick: () => void;
}) {
  const toneClass = {
    danger:
      "border-[#ff4d6d]/45 text-[#ff4d6d] hover:bg-[#ff2d55] hover:text-white",
    success:
      "border-[#40e070]/45 text-[#40e070] hover:bg-[#1fd060] hover:text-black",
  }[tone];
  const selectedClass = {
    danger:
      "scale-[1.08] border-[#ff4d6d] bg-[#ff2d55]/88 text-white shadow-[0_0_46px_rgba(255,45,85,0.42)] ring-[#ff4d6d]/45",
    success:
      "scale-[1.08] border-[#40e070] bg-[#1fd060]/88 text-black shadow-[0_0_46px_rgba(31,208,96,0.38)] ring-[#40e070]/45",
  }[tone];

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`grid h-20 w-20 place-items-center rounded-full border bg-black/72 text-xl font-black shadow-[0_24px_60px_-34px_rgba(0,0,0,0.95)] ring-1 ring-white/10 backdrop-blur-md transition duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] hover:-translate-y-1 active:scale-[0.96] disabled:pointer-events-none sm:h-24 sm:w-24 sm:text-2xl ${toneClass} ${
        selected ? selectedClass : ""
      }`}
    >
      {label}
    </button>
  );
}

function ScoreCell({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "success" | "danger" | "warning";
}) {
  const toneClass = {
    success: "text-[var(--success)]",
    danger: "text-[var(--danger)]",
    warning: "text-[var(--warning)]",
  }[tone];

  return (
    <div className="rounded-full bg-black/54 px-3 py-2 ring-1 ring-white/12 backdrop-blur-md lg:px-4">
      <p className={`text-lg font-black leading-none lg:text-xl ${toneClass}`}>
        {value}
      </p>
      <p className="mt-1 text-[0.68rem] font-bold leading-none text-white/68 lg:text-[0.72rem]">
        {label}
      </p>
    </div>
  );
}
