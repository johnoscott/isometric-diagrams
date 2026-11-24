import { loadFont } from '@remotion/fonts';
import { TransitionSeries } from '@remotion/transitions';
import { DEFAULT_THEME, IsometricScene, isometricFonts, isometricMetadata, isometricPresentation, isometricTiming, useIsometricCues, type DrawingProps } from '@johnoscott/isometric-engine/remotion';
import { AbsoluteFill, Composition, staticFile } from 'remotion';
import { DRAWING, MOTION } from './drawing';

// the font is this project's own (public/): the engine's package has none
loadFont(isometricFonts({ url: staticFile('Arimo-wght.ttf') }));

const drawing: DrawingProps = { src: DRAWING, theme: DEFAULT_THEME, motion: MOTION, font: 'arimo' };
const fps = 30;

const Caption = (p: DrawingProps) => (
  <div style={{ position: 'absolute', left: 80, right: 80, bottom: 48, font: '400 34px Arimo, Arial, sans-serif', color: '#1c2026' }}>{useIsometricCues(p)?.say?.text}</div>
);
const Story = (p: DrawingProps) => (
  <AbsoluteFill style={{ background: 'white' }}>
    <IsometricScene {...p} height="84%" />
    <Caption {...p} />
  </AbsoluteFill>
);

// the same drawing, first as it is and then in black and white, with the document's own fade between them
const timing = isometricTiming({ spring: { damping: 200 } });
const Two = () => (
  <AbsoluteFill style={{ background: 'white' }}>
    <TransitionSeries>
      <TransitionSeries.Sequence durationInFrames={90}>
        <IsometricScene {...drawing} />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={isometricPresentation()} timing={timing} />
      <TransitionSeries.Sequence durationInFrames={90}>
        <IsometricScene {...drawing} treatment="mono" />
      </TransitionSeries.Sequence>
    </TransitionSeries>
  </AbsoluteFill>
);

export const Root = () => (
  <>
    <Composition id="Story" component={Story} defaultProps={drawing} calculateMetadata={isometricMetadata({ fps, width: 1920, height: 1080 })} />
    <Composition id="Two" component={Two} fps={fps} width={1920} height={1080} durationInFrames={180 - timing.getDurationInFrames({ fps })} />
  </>
);
