import { useSiteContent } from '../../hooks/useSiteContent.js'

function BrandValues() {
  const { content } = useSiteContent('homepage.values')

  if (content?.enabled === false) return null

  const items = Array.isArray(content?.items) ? content.items : []

  return (
    <section aria-labelledby="home-values-heading" className="bg-ivory">
      <div className="clothza-container py-14 md:py-20">
        <h2 id="home-values-heading" className="type-label text-center">
          {content?.eyebrow || 'Why Clothza'}
        </h2>
        <div className="mx-auto mt-8 grid max-w-4xl gap-8 text-center sm:grid-cols-3 sm:gap-6">
          {items.map((v) => (
            <div key={v.index + v.title} className="flex flex-col items-center gap-2 px-2">
              <span className="text-xs font-medium tracking-[0.2em] text-fog">
                {v.index}
              </span>
              <h3 className="type-h3">{v.title}</h3>
              <p className="type-small max-w-[16rem]">{v.text}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

export default BrandValues
