/** Exercise photos and animated demonstrations from the wger catalogue. */

import { useEffect, useState } from 'react';
import { FiX } from 'react-icons/fi';
import type { Exercise, ExerciseMedia } from '../domain/types';
import { useMediaQuery } from '../state/hooks';

export function ExerciseMediaGallery({
  exercise,
  large = false,
}: {
  exercise: Exercise;
  large?: boolean;
}) {
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const [zoomed, setZoomed] = useState<ExerciseMedia | null>(null);
  const media = exercise.media ?? [];

  useEffect(() => {
    if (!zoomed) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setZoomed(null);
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKey);
    };
  }, [zoomed]);

  if (media.length === 0) return null;

  function sourceOf(item: ExerciseMedia): string {
    return item.animated && reduceMotion ? item.thumb : item.src;
  }

  return (
    <section
      className={`exercise-media${large ? ' exercise-media--large' : ''}`}
      aria-label={`${exercise.name} media`}
    >
      <div className="exercise-media__grid">
        {media.map((item, index) => (
          <figure className="exercise-media__item" key={item.id}>
            <button
              type="button"
              className="exercise-media__zoom"
              onClick={() => setZoomed(item)}
              aria-label={`Enlarge ${exercise.name} image`}
            >
              <img
                src={sourceOf(item)}
                alt={item.alt}
                loading={index === 0 ? 'eager' : 'lazy'}
                decoding="async"
              />
            </button>
            <figcaption>
              {item.animated ? <span className="exercise-media__badge">GIF</span> : null}
              <span>{item.author}</span>
              <a href={item.sourceUrl} target="_blank" rel="noreferrer">
                source
              </a>
              <span aria-hidden="true">·</span>
              <a href={item.licenseUrl} target="_blank" rel="noreferrer">
                {item.license}
              </a>
            </figcaption>
          </figure>
        ))}
      </div>
      {zoomed ? (
        <div
          className="media-zoom"
          role="dialog"
          aria-modal="true"
          aria-label={`${exercise.name} enlarged image`}
          onClick={() => setZoomed(null)}
        >
          <button
            type="button"
            className="icon-button media-zoom__close"
            aria-label="Close enlarged image"
            autoFocus
            onClick={() => setZoomed(null)}
          >
            <FiX aria-hidden="true" />
          </button>
          <img
            src={sourceOf(zoomed)}
            alt={zoomed.alt}
            onClick={(event) => event.stopPropagation()}
          />
        </div>
      ) : null}
    </section>
  );
}

export function ExerciseThumb({
  exercise,
  animated = false,
}: {
  exercise: Exercise;
  animated?: boolean;
}) {
  const first = exercise.media?.[0];
  if (!first) return null;
  if (!animated || !first.animated) return <ThumbImage src={first.thumb} />;
  return <AnimatedThumb src={first.src} still={first.thumb} />;
}

function AnimatedThumb({ src, still }: { src: string; still: string }) {
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  return <ThumbImage src={reduceMotion ? still : src} />;
}

function ThumbImage({ src }: { src: string }) {
  return <img className="exercise-thumb" src={src} alt="" loading="lazy" decoding="async" />;
}
