import { initDeviceStudio } from './shared/ui/deviceStudio.js'
import { initUiAdaptive } from './shared/ui/uiScale.js'
import { initTabBar } from './shared/ui/tabBar.js'
import { showHomePage, showTab, setAfterShowTab } from './shared/nav.js'
import { initHomePage, refreshHomePlaza, setHomeBannerAutoplay, setOpenHomePlazaDesign } from './pages/home/index.js'
import { initPlazaPage, refreshPlazaPage, setOpenPlazaDesign } from './pages/plaza/index.js'
import { initMyDesignsPage, refreshMyDesignsPage, setOpenPublishedDetails, setOpenSavedDesignDetails } from './pages/myDesigns/index.js'
import { initMePage } from './pages/me/index.js'
import { initEarningsPage } from './pages/earnings/index.js'
import { initOrdersPage } from './pages/orders/index.js'
import { initOrderDetailPage } from './pages/orderDetail/index.js'
import { initOrderGuidePage } from './pages/orderGuide/index.js'
import { initDesignerRulesPage } from './pages/designerRules/index.js'
import { initAddressPage } from './pages/address/index.js'
import { initCheckoutPage } from './pages/checkout/index.js'
import { initDiyPage } from './pages/diy/index.js'
import {
  initDetailsPage,
  openDesignDetails,
  openDesignDetailsFromPublish,
  openDesignDetailsFromPlaza,
  openDesignDetailsFromSaved,
} from './pages/details/index.js'
import { refreshPlazaRemote } from './shared/state/plazaRemoteStore.js'

function boot() {
  initUiAdaptive()
  initDeviceStudio()

  const app = document.getElementById('app')
  if (!app) throw new Error('#app missing')

  initHomePage(app)
  initPlazaPage(app)
  initMyDesignsPage(app)
  initMePage(app)
  initEarningsPage(app)
  initOrdersPage(app)
  initOrderDetailPage(app)
  initOrderGuidePage(app)
  initDesignerRulesPage(app)
  initAddressPage(app)
  initCheckoutPage(app)
  initTabBar(app, { onTabChange: showTab })

  setAfterShowTab((tab) => {
    setHomeBannerAutoplay(tab === 'home')
    if (tab === 'my-designs') refreshMyDesignsPage()
    if (tab === 'home' || tab === 'plaza') {
      void refreshPlazaRemote({ force: true }).then(() => {
        if (tab === 'home') refreshHomePlaza()
        if (tab === 'plaza') refreshPlazaPage()
      })
    }
  })

  const diy = initDiyPage(app, {
    onMakeNow: () => openDesignDetails(),
  })

  initDetailsPage(app, {
    getDesignImage: () => diy.exportImage(),
  })

  setOpenPublishedDetails((pub) => openDesignDetailsFromPublish(pub))
  setOpenSavedDesignDetails((design) => openDesignDetailsFromSaved(design))
  setOpenPlazaDesign((id) => openDesignDetailsFromPlaza(id))
  setOpenHomePlazaDesign((id) => openDesignDetailsFromPlaza(id))

  // Default entry: Home (DIY opens from CTA / stays reachable via back)
  showHomePage()
  void refreshPlazaRemote().then(() => refreshHomePlaza())
}

boot()
