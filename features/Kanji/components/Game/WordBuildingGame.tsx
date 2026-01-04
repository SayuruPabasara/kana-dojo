'use client';
import { useState, useEffect, useMemo, useCallback, useRef, memo } from 'react';
import { motion } from 'framer-motion';
import clsx from 'clsx';
import useKanjiStore, { IKanjiObj } from '@/features/Kanji/store/useKanjiStore';
import { Random } from 'random-js';
import { useCorrect, useError, useClick } from '@/shared/hooks/useAudio';
import { getGlobalAdaptiveSelector } from '@/shared/lib/adaptiveSelection';
import Stars from '@/shared/components/Game/Stars';
import { useCrazyModeTrigger } from '@/features/CrazyMode/hooks/useCrazyModeTrigger';
import useStatsStore from '@/features/Progress/store/useStatsStore';
import { useShallow } from 'zustand/react/shallow';
import { useStopwatch } from 'react-timer-hook';
import { useSmartReverseMode } from '@/shared/hooks/useSmartReverseMode';
import { GameBottomBar } from '@/shared/components/Game/GameBottomBar';
import FuriganaText from '@/shared/components/text/FuriganaText';

const random = new Random();
const adaptiveSelector = getGlobalAdaptiveSelector();

// Duolingo-like spring animation config
const springConfig = {
  type: 'spring' as const,
  stiffness: 400,
  damping: 30,
  mass: 0.8
};

// Premium entry animation variants for option tiles
const tileContainerVariants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.08,
      delayChildren: 0.15
    }
  }
};

const tileEntryVariants = {
  hidden: {
    opacity: 0,
    scale: 0.7,
    y: 20,
    rotateX: -15
  },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    rotateX: 0,
    transition: {
      type: 'spring' as const,
      stiffness: 350,
      damping: 25,
      mass: 0.8
    }
  }
};

// Celebration bounce animation for correct answers
const celebrationBounceVariants = {
  idle: {
    y: 0,
    scaleX: 1,
    scaleY: 1,
    opacity: 1
  },
  celebrate: {
    y: [0, -32, -35, 0, -10, 0],
    scaleX: [1, 0.94, 0.96, 1.06, 0.98, 1],
    scaleY: [1, 1.08, 1.04, 0.92, 1.02, 1],
    opacity: 1,
    transition: {
      duration: 1,
      ease: [0.16, 1, 0.3, 1] as [number, number, number, number],
      times: [0, 0.25, 0.35, 0.6, 0.8, 1]
    }
  }
};

// Tile styles shared between active and blank tiles
const tileBaseStyles =
  'relative flex items-center justify-center rounded-3xl px-6 sm:px-8 py-3 text-xl sm:text-2xl border-b-10 transition-all duration-150';

interface TileProps {
  id: string;
  char: string;
  reading?: string;
  onClick: () => void;
  isDisabled?: boolean;
  isKanji?: boolean;
}

// Active tile - uses layoutId for smooth position animations
const ActiveTile = memo(
  ({ id, char, reading, onClick, isDisabled, isKanji }: TileProps) => {
    return (
      <motion.button
        layoutId={id}
        layout='position'
        type='button'
        onClick={onClick}
        disabled={isDisabled}
        className={clsx(
          tileBaseStyles,
          'cursor-pointer transition-colors',
          'active:mb-[10px] active:translate-y-[10px] active:border-b-0',
          'border-[var(--secondary-color-accent)] bg-[var(--secondary-color)] text-[var(--background-color)]',
          isDisabled && 'cursor-not-allowed opacity-50'
        )}
        transition={springConfig}
        lang={isKanji ? 'ja' : undefined}
      >
        <FuriganaText text={char} reading={reading} />
      </motion.button>
    );
  }
);

ActiveTile.displayName = 'ActiveTile';

// Blank placeholder - no layoutId, just takes up space
const BlankTile = memo(
  ({ char, reading }: { char: string; reading?: string }) => {
    return (
      <div
        className={clsx(
          tileBaseStyles,
          'border-transparent bg-[var(--border-color)]/30',
          'select-none'
        )}
      >
        <span className='opacity-0'>
          <FuriganaText text={char} reading={reading} />
        </span>
      </div>
    );
  }
);

BlankTile.displayName = 'BlankTile';

// Bottom bar states
type BottomBarState = 'check' | 'correct' | 'wrong';

interface KanjiWordBuildingGameProps {
  selectedKanjiObjs: IKanjiObj[];
  isHidden: boolean;
  /** Optional: externally controlled reverse mode. If not provided, uses internal useSmartReverseMode */
  isReverse?: boolean;
  /** Optional: number of distractor tiles. Defaults to 3 (so 4 total options) */
  distractorCount?: number;
  /** Optional: callback when answer is correct */
  onCorrect?: (chars: string[]) => void;
  /** Optional: callback when answer is wrong */
  onWrong?: () => void;
}

const KanjiWordBuildingGame = ({
  selectedKanjiObjs,
  isHidden,
  isReverse: externalIsReverse,
  distractorCount: externalDistractorCount = 3,
  onCorrect: externalOnCorrect,
  onWrong: externalOnWrong
}: KanjiWordBuildingGameProps) => {
  // Smart reverse mode - used when not controlled externally
  const {
    isReverse: internalIsReverse,
    decideNextMode: decideNextReverseMode,
    recordWrongAnswer: recordReverseModeWrong
  } = useSmartReverseMode();

  // Use external isReverse if provided, otherwise use internal smart mode
  const isReverse = externalIsReverse ?? internalIsReverse;
  const distractorCount = Math.min(
    externalDistractorCount,
    selectedKanjiObjs.length - 1
  );

  // Get the current JLPT level from the Kanji store
  const selectedKanjiCollection = useKanjiStore(
    state => state.selectedKanjiCollection
  );

  // Answer timing for speed achievements
  const speedStopwatch = useStopwatch({ autoStart: false });
  const { playCorrect } = useCorrect();
  const { playErrorTwice } = useError();
  const { playClick } = useClick();
  const { trigger: triggerCrazyMode } = useCrazyModeTrigger();
  const buttonRef = useRef<HTMLButtonElement>(null);

  const {
    score,
    setScore,
    incrementKanjiCorrect,
    incrementWrongStreak,
    resetWrongStreak,
    recordAnswerTime,
    incrementCorrectAnswers,
    incrementWrongAnswers,
    addCharacterToHistory,
    incrementCharacterScore,
    addCorrectAnswerTime
  } = useStatsStore(
    useShallow(state => ({
      score: state.score,
      setScore: state.setScore,
      incrementKanjiCorrect: state.incrementKanjiCorrect,
      incrementWrongStreak: state.incrementWrongStreak,
      resetWrongStreak: state.resetWrongStreak,
      recordAnswerTime: state.recordAnswerTime,
      incrementCorrectAnswers: state.incrementCorrectAnswers,
      incrementWrongAnswers: state.incrementWrongAnswers,
      addCharacterToHistory: state.addCharacterToHistory,
      incrementCharacterScore: state.incrementCharacterScore,
      addCorrectAnswerTime: state.addCorrectAnswerTime
    }))
  );

  // Create Map for O(1) lookups
  const kanjiObjMap = useMemo(
    () => new Map(selectedKanjiObjs.map(obj => [obj.kanjiChar, obj])),
    [selectedKanjiObjs]
  );

  const [bottomBarState, setBottomBarState] = useState<BottomBarState>('check');

  // Generate question: 1 kanji with multiple answer options
  const generateQuestion = useCallback(() => {
    if (selectedKanjiObjs.length === 0) {
      return { kanjiChar: '', correctAnswer: '', allTiles: [] };
    }

    // Select a kanji using adaptive selection
    const kanjiChars = selectedKanjiObjs.map(obj => obj.kanjiChar);
    const selectedKanji = adaptiveSelector.selectWeightedCharacter(kanjiChars);
    adaptiveSelector.markCharacterSeen(selectedKanji);

    const selectedKanjiObj = kanjiObjMap.get(selectedKanji);
    if (!selectedKanjiObj) {
      return { kanjiChar: '', correctAnswer: '', allTiles: [] };
    }

    // In normal mode: show kanji, answer with meaning
    // In reverse mode: show meaning, answer with kanji
    const correctAnswer = isReverse
      ? selectedKanji
      : selectedKanjiObj.meanings[0];

    // Generate distractors
    const distractorSource = isReverse
      ? selectedKanjiObjs
          .filter(obj => obj.kanjiChar !== selectedKanji)
          .map(obj => obj.kanjiChar)
      : selectedKanjiObjs
          .filter(obj => obj.kanjiChar !== selectedKanji)
          .map(obj => obj.meanings[0]);

    const distractors = distractorSource
      .sort(() => random.real(0, 1) - 0.5)
      .slice(0, distractorCount);

    // Shuffle all tiles
    const allTiles = [correctAnswer, ...distractors].sort(
      () => random.real(0, 1) - 0.5
    );

    return {
      kanjiChar: selectedKanji,
      correctAnswer,
      allTiles,
      displayChar: isReverse ? selectedKanjiObj.meanings[0] : selectedKanji
    };
  }, [isReverse, selectedKanjiObjs, distractorCount, kanjiObjMap]);

  const [questionData, setQuestionData] = useState(() => generateQuestion());
  const [selectedTile, setSelectedTile] = useState<string | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [isCelebrating, setIsCelebrating] = useState(false);

  const resetGame = useCallback(() => {
    const newQuestion = generateQuestion();
    setQuestionData(newQuestion);
    setSelectedTile(null);
    setIsChecking(false);
    setIsCelebrating(false);
    setBottomBarState('check');
    // Start timing for the new question
    speedStopwatch.reset();
    speedStopwatch.start();
  }, [generateQuestion]);

  useEffect(() => {
    resetGame();
  }, [isReverse, resetGame]);

  // Pause stopwatch when game is hidden
  useEffect(() => {
    if (isHidden) {
      speedStopwatch.pause();
    }
  }, [isHidden]);

  // Keyboard shortcut for Enter/Space to trigger button
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === 'Enter' ||
        event.code === 'Space' ||
        event.key === ' '
      ) {
        buttonRef.current?.click();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Handle Check button
  const handleCheck = useCallback(() => {
    if (!selectedTile) return;

    // Stop timing and record answer time
    speedStopwatch.pause();
    const answerTimeMs = speedStopwatch.totalMilliseconds;

    playClick();
    setIsChecking(true);

    const isCorrect = selectedTile === questionData.correctAnswer;

    if (isCorrect) {
      // Record answer time for speed achievements
      addCorrectAnswerTime(answerTimeMs / 1000);
      recordAnswerTime(answerTimeMs);
      speedStopwatch.reset();

      playCorrect();
      triggerCrazyMode();
      resetWrongStreak();

      // Track stats for the kanji
      addCharacterToHistory(questionData.kanjiChar);
      incrementCharacterScore(questionData.kanjiChar, 'correct');
      adaptiveSelector.updateCharacterWeight(questionData.kanjiChar, true);
      incrementKanjiCorrect(selectedKanjiCollection.toUpperCase());

      incrementCorrectAnswers();
      setScore(score + 1);
      setBottomBarState('correct');
      setIsCelebrating(true);

      // Advance smart reverse mode if not externally controlled
      if (externalIsReverse === undefined) {
        decideNextReverseMode();
      }
    } else {
      speedStopwatch.reset();
      playErrorTwice();
      triggerCrazyMode();
      incrementWrongStreak();
      incrementWrongAnswers();

      incrementCharacterScore(questionData.kanjiChar, 'wrong');
      adaptiveSelector.updateCharacterWeight(questionData.kanjiChar, false);

      if (score - 1 >= 0) {
        setScore(score - 1);
      }

      setBottomBarState('wrong');

      // Reset smart reverse mode streak if not externally controlled
      if (externalIsReverse === undefined) {
        recordReverseModeWrong();
      }

      externalOnWrong?.();
    }
  }, [
    selectedTile,
    questionData,
    playClick,
    playCorrect,
    playErrorTwice,
    triggerCrazyMode,
    resetWrongStreak,
    incrementWrongStreak,
    addCharacterToHistory,
    incrementCharacterScore,
    incrementKanjiCorrect,
    selectedKanjiCollection,
    incrementCorrectAnswers,
    incrementWrongAnswers,
    score,
    setScore,
    externalOnWrong,
    externalIsReverse,
    decideNextReverseMode,
    recordReverseModeWrong,
    addCorrectAnswerTime,
    recordAnswerTime
  ]);

  // Handle Continue button (only for correct answers)
  const handleContinue = useCallback(() => {
    playClick();
    externalOnCorrect?.([questionData.kanjiChar]);
    resetGame();
  }, [playClick, externalOnCorrect, questionData.kanjiChar, resetGame]);

  // Handle Try Again button (for wrong answers)
  const handleTryAgain = useCallback(() => {
    playClick();
    setSelectedTile(null);
    setIsChecking(false);
    setBottomBarState('check');
    speedStopwatch.reset();
    speedStopwatch.start();
  }, [playClick]);

  // Handle tile click - select a tile
  const handleTileClick = useCallback(
    (char: string) => {
      if (isChecking && bottomBarState !== 'wrong') return;

      playClick();

      // If in wrong state, reset to check state
      if (bottomBarState === 'wrong') {
        setIsChecking(false);
        setBottomBarState('check');
        speedStopwatch.reset();
        speedStopwatch.start();
      }

      // Toggle selection
      if (selectedTile === char) {
        setSelectedTile(null);
      } else {
        setSelectedTile(char);
      }
    },
    [isChecking, bottomBarState, selectedTile, playClick]
  );

  // Not enough characters
  if (selectedKanjiObjs.length < 2 || !questionData.kanjiChar) {
    return null;
  }

  const canCheck = selectedTile !== null && !isChecking;
  const showContinue = bottomBarState === 'correct';
  const showTryAgain = bottomBarState === 'wrong';

  // Helper to get reading for a kanji tile
  const getKanjiReading = (kanjiChar: string) => {
    const obj = kanjiObjMap.get(kanjiChar);
    return obj?.onyomi[0] || obj?.kunyomi[0];
  };

  // Get the kanji object for display
  const currentKanjiObj = kanjiObjMap.get(questionData.kanjiChar);

  return (
    <div
      className={clsx(
        'flex w-full flex-col items-center gap-6 sm:w-4/5 sm:gap-10',
        isHidden && 'hidden'
      )}
    >
      {/* Question Display - shows kanji in normal mode, meaning in reverse mode */}
      <div className='flex flex-row items-center gap-1'>
        <motion.div
          className='flex flex-row items-center gap-2'
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          key={questionData.kanjiChar}
        >
          <span
            className={clsx(
              isReverse ? 'text-5xl sm:text-6xl' : 'text-8xl sm:text-9xl'
            )}
            lang={!isReverse ? 'ja' : undefined}
          >
            {!isReverse ? (
              <FuriganaText
                text={questionData.kanjiChar}
                reading={getKanjiReading(questionData.kanjiChar)}
              />
            ) : (
              currentKanjiObj?.meanings[0]
            )}
          </span>
        </motion.div>
      </div>

      {/* Answer Row Area - shows selected tile */}
      <div className='flex w-full flex-col items-center'>
        <div className='flex min-h-[5rem] w-full items-center justify-center border-b-2 border-[var(--border-color)] px-2 pb-2 md:w-3/4 lg:w-2/3 xl:w-1/2'>
          <motion.div
            className='flex flex-row flex-wrap justify-center gap-3'
            variants={celebrationBounceVariants}
            initial='idle'
            animate={isCelebrating ? 'celebrate' : 'idle'}
          >
            {selectedTile && (
              <ActiveTile
                id={`tile-${selectedTile}`}
                char={selectedTile}
                reading={isReverse ? getKanjiReading(selectedTile) : undefined}
                onClick={() => handleTileClick(selectedTile)}
                isDisabled={isChecking && bottomBarState !== 'wrong'}
                isKanji={isReverse}
              />
            )}
          </motion.div>
        </div>
      </div>

      {/* Available Tiles - 2 rows */}
      {(() => {
        const tilesPerRow = 2;
        const topRowTiles = questionData.allTiles.slice(0, tilesPerRow);
        const bottomRowTiles = questionData.allTiles.slice(tilesPerRow);

        const renderTile = (char: string) => {
          const isSelected = selectedTile === char;
          const isKanjiTile = isReverse;

          return (
            <motion.div
              key={`tile-slot-${char}`}
              className='relative'
              variants={tileEntryVariants}
              style={{ perspective: 1000 }}
            >
              {/* Blank tile underneath */}
              <BlankTile
                char={char}
                reading={isKanjiTile ? getKanjiReading(char) : undefined}
              />

              {/* Active tile on top when NOT selected */}
              {!isSelected && (
                <div className='absolute inset-0 z-10'>
                  <ActiveTile
                    id={`tile-${char}`}
                    char={char}
                    reading={isKanjiTile ? getKanjiReading(char) : undefined}
                    onClick={() => handleTileClick(char)}
                    isDisabled={isChecking && bottomBarState !== 'wrong'}
                    isKanji={isKanjiTile}
                  />
                </div>
              )}
            </motion.div>
          );
        };

        return (
          <motion.div
            key={questionData.kanjiChar}
            className='flex flex-col items-center gap-3 sm:gap-4'
            variants={tileContainerVariants}
            initial='hidden'
            animate='visible'
          >
            <motion.div className='flex flex-row justify-center gap-3 sm:gap-4'>
              {topRowTiles.map(char => renderTile(char))}
            </motion.div>
            {bottomRowTiles.length > 0 && (
              <motion.div className='flex flex-row justify-center gap-3 sm:gap-4'>
                {bottomRowTiles.map(char => renderTile(char))}
              </motion.div>
            )}
          </motion.div>
        );
      })()}

      <Stars />

      <GameBottomBar
        state={bottomBarState}
        onAction={
          showContinue
            ? handleContinue
            : showTryAgain
              ? handleTryAgain
              : handleCheck
        }
        canCheck={canCheck}
        feedbackContent={questionData.correctAnswer}
        buttonRef={buttonRef}
      />

      {/* Spacer */}
      <div className='h-32' />
    </div>
  );
};

export default KanjiWordBuildingGame;
