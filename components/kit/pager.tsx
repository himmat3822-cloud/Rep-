import Link from 'next/link'

// Server-side pagination links that keep the other query params.
export function Pager({ page, pages, total, basePath, params }: { page: number; pages: number; total: number; basePath: string; params: Record<string, string | undefined> }) {
  const href = (target: number) => {
    const query = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) if (value) query.set(key, value)
    query.set('page', String(target))
    return `${basePath}?${query.toString()}`
  }
  return (
    <div className="pager">
      <span>
        {total} total - page {page} of {pages}
      </span>
      <div>
        {page > 1 ? (
          <Link className="btn btn-outline btn-sm" href={href(page - 1)}>
            Previous
          </Link>
        ) : null}
        {page < pages ? (
          <Link className="btn btn-outline btn-sm" href={href(page + 1)}>
            Next
          </Link>
        ) : null}
      </div>
    </div>
  )
}
