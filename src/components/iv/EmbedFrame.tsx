import { memo, useEffect, useMemo, useRef, useState } from '../../lib/teact/teact';

import type { ApiPageBlockEmbed } from '../../api/types';

import { EMBED_ALLOW_ATTRIBUTES, IFRAME_SANDBOX_ATTRIBUTES, isMessageFromIframe } from '../../util/browser/iframe';
import buildStyle from '../../util/buildStyle';
import { extractInstantViewEmbedUrl } from '../../util/instantViewEmbed';
import { isLiteralObject } from '../../util/iteratees';

import useWindow from '../../hooks/useWindow';

import styles from './RichContent.module.scss';

type OwnProps = {
  block: ApiPageBlockEmbed;
  title: string;
};

type EmbedFrameResizeEvent = {
  eventType: 'resize_frame';
  eventData: {
    height: number;
  };
};

type EmbedFrameEvent = EmbedFrameResizeEvent;

// Long-form embeds can span many screens, but larger frames create disproportionate layout work
const MAX_EMBED_FRAME_HEIGHT_PX = 10_000;

function EmbedFrame({ block, title }: OwnProps) {
  const renderingWindow = useWindow();
  const frameRef = useRef<HTMLIFrameElement>();
  const [frameHeight, setFrameHeight] = useState<number>();

  const embedUrl = useMemo(() => {
    return block.url || extractInstantViewEmbedUrl(block.html!);
  }, [block.html, block.url]);

  useEffect(() => {
    let pendingFrameHeight: number | undefined;
    let resizeAnimationFrame: number | undefined;

    function handleMessage(event: MessageEvent<string>) {
      if (!isMessageFromIframe(event, frameRef.current)) {
        return;
      }

      try {
        const parsed: unknown = JSON.parse(event.data);
        const data = parseEmbedFrameEvent(parsed);
        if (!data) {
          return;
        }

        switch (data.eventType) {
          case 'resize_frame': {
            scheduleFrameResize(data.eventData.height);
            break;
          }
          default:
            break;
        }
      } catch {
        // Ignore other messages
      }
    }

    function scheduleFrameResize(height: number) {
      pendingFrameHeight = height;
      if (resizeAnimationFrame !== undefined) {
        return;
      }

      resizeAnimationFrame = renderingWindow.requestAnimationFrame(() => {
        resizeAnimationFrame = undefined;
        setFrameHeight(pendingFrameHeight!);
        pendingFrameHeight = undefined;
      });
    }

    renderingWindow.addEventListener('message', handleMessage);
    return () => {
      renderingWindow.removeEventListener('message', handleMessage);
      if (resizeAnimationFrame !== undefined) {
        renderingWindow.cancelAnimationFrame(resizeAnimationFrame);
      }
    };
  }, [renderingWindow]);

  if (!embedUrl) {
    return undefined;
  }

  const height = frameHeight ?? parseEmbedFrameHeight(block.height);
  const style = buildStyle(
    block.width !== undefined && `width: ${block.width}px`,
    height !== undefined && `height: ${height}px`,
  );

  return (
    <iframe
      ref={frameRef}
      className={styles.embedFrame}
      src={embedUrl}
      title={title}
      sandbox={IFRAME_SANDBOX_ATTRIBUTES}
      allow={EMBED_ALLOW_ATTRIBUTES}
      allowFullScreen
      scrolling={block.shouldAllowScrolling ? 'yes' : 'no'}
      style={style}
    />
  );
}

export default memo(EmbedFrame);

function parseEmbedFrameEvent(data: unknown): EmbedFrameEvent | undefined {
  if (!isLiteralObject(data)) {
    return undefined;
  }

  switch (data.eventType) {
    case 'resize_frame': {
      const height = parseEmbedFrameHeight(data.eventData?.height);
      if (height === undefined) {
        return undefined;
      }

      return {
        eventType: 'resize_frame',
        eventData: { height },
      };
    }
    default:
      return undefined;
  }
}

function parseEmbedFrameHeight(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > MAX_EMBED_FRAME_HEIGHT_PX) {
    return undefined;
  }

  return value;
}
