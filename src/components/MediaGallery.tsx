import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, Download, FileText, X } from 'lucide-react'
import type { MediaFile } from '../../shared/types'
import { humanFileSize } from '../lib/date'

interface MediaGalleryProps {
  files: MediaFile[]
  limit?: number
  onRemove?: (file: MediaFile) => void
  className?: string
}

function Lightbox({
  images,
  index,
  onClose,
  onIndexChange,
}: {
  images: MediaFile[]
  index: number
  onClose: () => void
  onIndexChange: (index: number) => void
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      if (event.key === 'ArrowRight') onIndexChange((index + 1) % images.length)
      if (event.key === 'ArrowLeft') onIndexChange((index - 1 + images.length) % images.length)
    }
    window.addEventListener('keydown', onKeyDown)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previous
    }
  }, [index, images.length, onClose, onIndexChange])

  const current = images[index]
  if (!current) return null

  return createPortal(
    <div className="lightbox" onClick={onClose} role="dialog" aria-modal="true">
      <div className="lightbox-top" onClick={(event) => event.stopPropagation()}>
        <span className="lightbox-name">{current.name}</span>
        <div className="lightbox-actions">
          <a className="icon-btn lightbox-btn" href={current.url} download={current.name} aria-label="Скачать">
            <Download size={18} />
          </a>
          <button className="icon-btn lightbox-btn" onClick={onClose} aria-label="Закрыть">
            <X size={19} />
          </button>
        </div>
      </div>
      <div className="lightbox-stage" onClick={(event) => event.stopPropagation()}>
        {images.length > 1 && (
          <button
            className="lightbox-nav lightbox-prev"
            onClick={() => onIndexChange((index - 1 + images.length) % images.length)}
            aria-label="Предыдущее изображение"
          >
            <ChevronLeft size={24} />
          </button>
        )}
        <img src={current.url} alt={current.name} className="lightbox-image" />
        {images.length > 1 && (
          <button
            className="lightbox-nav lightbox-next"
            onClick={() => onIndexChange((index + 1) % images.length)}
            aria-label="Следующее изображение"
          >
            <ChevronRight size={24} />
          </button>
        )}
      </div>
      {images.length > 1 && (
        <div className="lightbox-counter">{index + 1} / {images.length}</div>
      )}
    </div>,
    document.body,
  )
}

export function MediaGallery({ files, limit = 6, onRemove, className = '' }: MediaGalleryProps) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
  if (!files.length) return null

  const images = files.filter((file) => file.mime.startsWith('image/'))
  const videos = files.filter((file) => file.mime.startsWith('video/'))
  const audios = files.filter((file) => file.mime.startsWith('audio/'))
  const documents = files.filter(
    (file) =>
      !file.mime.startsWith('image/') &&
      !file.mime.startsWith('video/') &&
      !file.mime.startsWith('audio/'),
  )
  const visibleImages = images.slice(0, limit)
  const hiddenCount = images.length - visibleImages.length

  return (
    <div className={`media-gallery ${className}`}>
      {images.length > 0 && (
        <div className={`media-grid media-grid-${Math.min(visibleImages.length, 3)}`}>
          {visibleImages.map((file, index) => (
            <figure className="media-thumb" key={file.id}>
              <button
                type="button"
                className="media-thumb-open"
                onClick={() => setLightboxIndex(index)}
                aria-label={`Открыть ${file.name}`}
              >
                <img src={file.url} alt={file.name} loading="lazy" />
              </button>
              {hiddenCount > 0 && index === visibleImages.length - 1 && (
                <button
                  type="button"
                  className="media-more"
                  onClick={() => setLightboxIndex(index)}
                  aria-label={`Ещё ${hiddenCount}`}
                >
                  +{hiddenCount}
                </button>
              )}
              {onRemove && (
                <button
                  type="button"
                  className="media-remove"
                  onClick={() => onRemove(file)}
                  aria-label={`Удалить ${file.name}`}
                >
                  <X size={13} />
                </button>
              )}
            </figure>
          ))}
        </div>
      )}

      {videos.map((file) => (
        <div className="media-video" key={file.id}>
          <video src={file.url} controls preload="metadata" />
          {onRemove && (
            <button
              type="button"
              className="media-remove"
              onClick={() => onRemove(file)}
              aria-label={`Удалить ${file.name}`}
            >
              <X size={13} />
            </button>
          )}
        </div>
      ))}

      {audios.map((file) => (
        <div className="media-audio" key={file.id}>
          <div className="media-audio-meta">
            <span className="media-audio-name">{file.name}</span>
            {onRemove && (
              <button
                type="button"
                className="icon-btn tiny-btn"
                onClick={() => onRemove(file)}
                aria-label={`Удалить ${file.name}`}
              >
                <X size={13} />
              </button>
            )}
          </div>
          <audio src={file.url} controls preload="metadata" />
        </div>
      ))}

      {documents.length > 0 && (
        <div className="media-files">
          {documents.map((file) => (
            <div className="media-file" key={file.id}>
              <a
                className="media-file-link"
                href={file.url}
                target="_blank"
                rel="noreferrer"
                download={file.name}
              >
                <span className="media-file-icon">
                  <FileText size={17} />
                </span>
                <span className="media-file-copy">
                  <span className="media-file-name">{file.name}</span>
                  <span className="media-file-size">{humanFileSize(file.size)}</span>
                </span>
                <Download size={15} className="media-file-download" />
              </a>
              {onRemove && (
                <button
                  type="button"
                  className="icon-btn tiny-btn"
                  onClick={() => onRemove(file)}
                  aria-label={`Удалить ${file.name}`}
                >
                  <X size={13} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {lightboxIndex !== null && images.length > 0 && (
        <Lightbox
          images={images}
          index={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onIndexChange={setLightboxIndex}
        />
      )}
    </div>
  )
}
