import { Link } from 'react-router-dom'
import { useSiteContent } from '../hooks/useSiteContent.js'

/* Placeholder info page. When `page` is provided (about | contact |
   shipping | returns | faq), eyebrow/title/note come from the CMS
   `site.pages` section with the props below as safe fallbacks — the
   page looks identical until an admin edits it. */

function Placeholder({ eyebrow = 'Coming soon', title = 'Page', note = 'This page will be built in a later step.', page = null }) {
  const { content } = useSiteContent('site.pages')
  const liveEyebrow = page && content?.[`${page}Eyebrow`] ? content[`${page}Eyebrow`] : eyebrow
  const liveTitle = page && content?.[`${page}Title`] ? content[`${page}Title`] : title
  const liveNote = page && content?.[`${page}Note`] ? content[`${page}Note`] : note

  return (
    <main className="bg-ivory text-charcoal">
      <div className="clothza-container clothza-section">
        <div className="mx-auto flex w-full max-w-2xl flex-col items-start gap-4 text-left">
          <p className="type-label">{liveEyebrow}</p>
          <h1 className="type-h2">{liveTitle}</h1>
          <p className="type-body-muted">{liveNote}</p>
          <Link to="/" className="btn btn-secondary mt-2">
            Back to home
          </Link>
        </div>
      </div>
    </main>
  )
}

export default Placeholder
