import { Link } from 'react-router-dom'

function Placeholder({ eyebrow = 'Coming soon', title = 'Page', note = 'This page will be built in a later step.' }) {
  return (
    <main className="bg-ivory text-charcoal">
      <div className="clothza-container clothza-section">
        <div className="mx-auto flex w-full max-w-2xl flex-col items-start gap-4 text-left">
          <p className="type-label">{eyebrow}</p>
          <h1 className="type-h2">{title}</h1>
          <p className="type-body-muted">{note}</p>
          <Link to="/" className="btn btn-secondary mt-2">
            Back to home
          </Link>
        </div>
      </div>
    </main>
  )
}

export default Placeholder
