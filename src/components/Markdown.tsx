import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

export function Markdown({
  children,
  className = '',
}: {
  children: string
  className?: string
}) {
  return (
    <div className={`md ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ node: _node, ...props }) => (
            <a {...props} target="_blank" rel="noreferrer noopener" />
          ),
          input: ({ node: _node, ...props }) => <input {...props} disabled />,
        }}
      >
        {children || ''}
      </ReactMarkdown>
    </div>
  )
}
