import BrandValues from '../components/home/BrandValues.jsx'
import CategorySection from '../components/home/CategorySection.jsx'
import EditorialBanner from '../components/home/EditorialBanner.jsx'
import Hero from '../components/home/Hero.jsx'
import NewArrivals from '../components/home/NewArrivals.jsx'
import Newsletter from '../components/home/Newsletter.jsx'

function Home() {
  return (
    <main className="bg-ivory text-charcoal">
      <Hero />
      <CategorySection />
      <NewArrivals />
      <EditorialBanner />
      <BrandValues />
      <Newsletter />
    </main>
  )
}

export default Home
