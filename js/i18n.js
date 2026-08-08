// ============================================
// NŪR — Internationalization (TJ/RU/EN)
// ============================================

const translations = {
  tj: {
    appName: 'NŪR',
    appTagline: 'Истгоҳҳои барқии Душанбе',
    findNearest: 'Наздиктаринро ёб',
    findNearestShort: 'Ёфтан',
    stations: 'Истгоҳҳо',
    freeConnectors: 'Пайвасткунакҳои озод',
    allStations: 'Ҳамаи истгоҳҳо',
    nearest: 'Наздиктарин',
    recommended: 'Тавсияшуда',
    distance: 'Масофа',
    power: 'Қувват',
    tariff: 'Тариф',
    schedule: 'Вақти кор',
    connector: 'Пайвасткунак',
    available: 'Озод',
    charging: 'Заряд мешавад',
    chargeLabel: 'Заряд',
    occupied: 'Банд',
    chargeLevel: 'Сатҳи заряд',
    navigateTo: 'Нишон додан дар харита',
    getDirections: 'Масир',
    closePanel: 'Пӯшидан',
    loading: 'Боркунӣ...',
    error: 'Хатогӣ',
    errorLoading: 'Хатогии боркунии маълумот',
    retry: 'Аз нав кӯшиш кунед',
    locationDenied: 'Рухсати ҷойгиршавӣ рад шуд',
    locationUnavailable: 'Ҷойгиршавӣ дастнорас',
    locationFound: 'Ҷойгиршавӣ ёфт шуд',
    locating: 'Ҷустуҷӯи мавқеъ...',
    locConsentTag: 'Дар дастгоҳ',
    locConsentTitle: 'Зарядгоҳи наздикро ёбед',
    locConsentBody: 'Ба ҷойгиршавӣ иҷозат диҳед — NŪR зарядгоҳи наздиктарини озодро нишон медиҳад ва масир месозад.',
    locConsentAllow: 'Иҷозат додан',
    locConsentDeny: 'Ҳоло не',
    locConsentNote: 'Мо ҳеҷ гоҳ ҷойгиршавии шуморо нигоҳ намедорем.',
    myLocation: 'Мавқеи ман',
    noFreeStations: 'Истгоҳи озод нест',
    noStations: 'Истгоҳе нест',
    bestChoice: 'Беҳтарин интихоб',
    freeNow: 'Ҳозир озод',
    soonFree: 'Ба наздикӣ озод мешавад',
    busy: 'Банд',
    somoniPerKwh: 'сом./кВт',
    meters: 'м',
    km: 'км',
    minSuffix: 'дақ',
    hrSuffix: 'соат',
    stationDetails: 'Маълумоти истгоҳ',
    filterAll: 'Ҳама',
    filterAvailable: 'Озод',
    filter120w: '120W',
    filter60w: '60W',
    totalStations: 'Истгоҳҳо',
    availableNow: 'Озод',
    lastUpdate: 'Навсозии охирин',
    searchPlaceholder: 'Ҷустуҷӯи истгоҳ...',
    walking: 'Пиёда',
    openNow: 'Кушода',
    closedUntil: 'Пӯшида то',
    open247: '24/7',
    freeIn: 'Озод мешавад тақрибан',
    etaSoon: 'Ба наздикӣ озод',
    etaSoonShort: 'ба зудӣ',
    allBusy: 'Ҳамаи пайвасткунакҳо банд',
    occupiedNow: 'Банд',
    notifNotSupported: 'Браузери шумо огоҳиномаҳоро дастгирӣ намекунад',
    notifDisabled: 'Огоҳиномаҳо хомӯш карда шуданд',
    notifDenied: 'Барои фиристодани огоҳиномаҳо иҷозат диҳед',
    notifEnabled: 'Огоҳиномаҳо фаъол карда шуданд',
    notifDisableTitle: 'Хомӯш кардани огоҳиномаҳо',
    notifEnableTitle: 'Фаъол кардани огоҳиномаҳо',
    notifTitle: 'Истгоҳ озод шуд!',
    routeBuilding: 'Маршрут омода мешавад...',
    routeReady: 'Маршрут омода шуд',
    routeUpdated: 'Маршрут нав карда шуд',
    routeError: 'Маршрут сохта нашуд',
    routeLabel: 'Маршрут',
    routeCleared: 'Маршрут пок карда шуд',
    routeArrived: 'Шумо расидед 🎉',
    openGoogleMaps: 'Google Maps-ро кушед',
    liveTrackingOn: 'Пайгирии зинда фаъол шуд',
    liveTrackingOff: 'Пайгирии зинда хомӯш шуд',
    calcEyebrow: 'Ҳисобкунак',
    calcTitle: 'Арзиши зарядкунӣ',
    calcStation: 'Истгоҳ',
    calcSelectStation: 'Истгоҳро интихоб кунед',
    calcBattery: 'Батарея',
    calcCurrent: 'Заряди ҷорӣ',
    calcTarget: 'Заряди матлуб',
    calcTariff: 'Тариф',
    calcPower: 'Қувват',
    calcEnergy: 'Энергия',
    calcCost: 'Арзиш',
    calcTime: 'Вақт',
    somoniPerKwhShort: 'сом.',
    installApp: 'Насб кардан',
    installHint: 'Барномаро ба экрани асосӣ илова кунед',
    // Install instructions, one entry per browser situation.
    install: {
      iosAlt: {
        title: '{browser} дар iPhone барнома насб карда наметавонад',
        steps: [
          'Дар iPhone <strong>Safari</strong>-ро кушоед',
          'Боз ба ин сомона гузаред',
          'Тугмаи <strong>Мубодила</strong> <span aria-hidden="true">⎋</span> → <strong>«Ба экрани асосӣ»</strong>',
        ],
        note: 'Ин маҳдудияти Apple аст: дар iOS танҳо Safari веб-барномаро ба экрани асосӣ насб карда метавонад',
      },
      ios: {
        title: 'NŪR — iPhone / iPad',
        steps: [
          'Тугмаи <strong>Мубодила</strong> <span aria-hidden="true">⎋</span>-ро дар поёни экран пахш кунед',
          'Ба поён ҳаракат карда <strong>«Ба экрани асосӣ»</strong>-ро интихоб кунед',
          'Дар кунҷи болоии рост <strong>«Илова кардан»</strong>-ро пахш кунед',
        ],
      },
      samsung: {
        title: 'NŪR — Samsung Internet',
        steps: [
          'Менюро кушоед (аломати <strong>☰</strong> дар поён)',
          '<strong>«Иловаи саҳифа ба»</strong>-ро интихоб кунед',
          '<strong>«Экрани асосӣ»</strong>-ро пахш кунед',
        ],
      },
      ffAndroid: {
        title: 'NŪR — Firefox',
        steps: [
          'Менюро кушоед (се нуқта <strong>⋮</strong>)',
          '<strong>«Насб кардан»</strong> ё <strong>«Ба экрани асосӣ»</strong>-ро интихоб кунед',
          'Насбро тасдиқ кунед',
        ],
      },
      ffDesktop: {
        title: 'NŪR — Firefox',
        steps: [
          'Firefox дар компютер ҳанӯз насби PWA-ро дастгирӣ намекунад',
          'Бо <strong>Ctrl/Cmd + D</strong> хатбарак созед',
          'Ё барои насб сомонаро дар Chrome/Edge кушоед',
        ],
      },
      android: {
        title: 'NŪR — Android',
        steps: [
          'Менюи браузерро кушоед (се нуқта <strong>⋮</strong>)',
          '<strong>«Насби барнома»</strong> ё <strong>«Ба экрани асосӣ»</strong>-ро интихоб кунед',
          'Тасдиқ кунед — NŪR ҳамчун барномаи оддӣ пайдо мешавад',
        ],
        note: 'Агар ин банд набошад — Chrome-ро истифода баред ё браузерро нав кунед',
      },
      desktop: {
        title: 'NŪR — насб',
        steps: [
          'Дар сатри суроға аз тарафи рост аломати <strong>«Насб»</strong> ⊕-ро ёбед',
          'Ё менюи браузер (⋮) → <strong>«Насби NŪR»</strong>',
          'Дар равзанаи муколама <strong>«Насб»</strong>-ро пахш кунед',
        ],
        note: 'Барнома дар равзанаи алоҳида бе сатри суроға кушода мешавад',
      },
    },
  },
  ru: {
    appName: 'NŪR',
    appTagline: 'Электрозарядные станции Душанбе',
    findNearest: 'Найти ближайшую',
    findNearestShort: 'Найти',
    stations: 'Станции',
    freeConnectors: 'Свободные коннекторы',
    allStations: 'Все станции',
    nearest: 'Ближайшие',
    recommended: 'Рекомендуемые',
    distance: 'Расстояние',
    power: 'Мощность',
    tariff: 'Тариф',
    schedule: 'Режим работы',
    connector: 'Коннектор',
    available: 'Свободен',
    charging: 'Заряжается',
    chargeLabel: 'Заряд',
    occupied: 'Занят',
    chargeLevel: 'Уровень заряда',
    navigateTo: 'Показать на карте',
    getDirections: 'Маршрут',
    closePanel: 'Закрыть',
    loading: 'Загрузка...',
    error: 'Ошибка',
    errorLoading: 'Ошибка загрузки данных',
    retry: 'Повторить попытку',
    locationDenied: 'Доступ к геолокации запрещён',
    locationUnavailable: 'Геолокация недоступна',
    locationFound: 'Местоположение найдено',
    locating: 'Определение местоположения...',
    locConsentTag: 'На устройстве',
    locConsentTitle: 'Зарядки рядом с вами',
    locConsentBody: 'Разрешите доступ к геолокации — NŪR укажет ближайшую свободную зарядку и построит маршрут.',
    locConsentAllow: 'Разрешить',
    locConsentDeny: 'Не сейчас',
    locConsentNote: 'Мы не храним и не передаём ваше местоположение.',
    myLocation: 'Моя локация',
    noFreeStations: 'Нет свободных станций',
    noStations: 'Нет станций',
    bestChoice: 'Лучший выбор',
    freeNow: 'Сейчас свободна',
    soonFree: 'Скоро освободится',
    busy: 'Занята',
    somoniPerKwh: 'сом./кВт',
    meters: 'м',
    km: 'км',
    minSuffix: 'мин',
    hrSuffix: 'ч',
    stationDetails: 'Информация о станции',
    filterAll: 'Все',
    filterAvailable: 'Свободные',
    filter120w: '120W',
    filter60w: '60W',
    totalStations: 'Станции',
    availableNow: 'Свободно',
    lastUpdate: 'Обновлено',
    searchPlaceholder: 'Поиск станции...',
    walking: 'Пешком',
    openNow: 'Открыто',
    closedUntil: 'Закрыто до',
    open247: '24/7',
    freeIn: 'Освободится примерно через',
    etaSoon: 'Скоро освободится',
    etaSoonShort: 'скоро',
    allBusy: 'Все коннекторы заняты',
    occupiedNow: 'Занято',
    notifNotSupported: 'Ваш браузер не поддерживает уведомления',
    notifDisabled: 'Уведомления отключены',
    notifDenied: 'Пожалуйста, разрешите отправку уведомлений',
    notifEnabled: 'Уведомления включены',
    notifDisableTitle: 'Отключить уведомления',
    notifEnableTitle: 'Включить уведомления',
    notifTitle: 'Станция освободилась!',
    routeBuilding: 'Строим маршрут...',
    routeReady: 'Маршрут построен',
    routeUpdated: 'Маршрут обновлён',
    routeError: 'Не удалось построить маршрут',
    routeLabel: 'Маршрут',
    routeCleared: 'Маршрут удалён',
    routeArrived: 'Вы прибыли 🎉',
    openGoogleMaps: 'Открыть в Google Maps',
    liveTrackingOn: 'Отслеживание местоположения включено',
    liveTrackingOff: 'Отслеживание местоположения выключено',
    calcEyebrow: 'Калькулятор',
    calcTitle: 'Стоимость зарядки',
    calcStation: 'Станция',
    calcSelectStation: 'Выберите станцию',
    calcBattery: 'Батарея автомобиля',
    calcCurrent: 'Текущий заряд',
    calcTarget: 'Целевой заряд',
    calcTariff: 'Тариф',
    calcPower: 'Мощность',
    calcEnergy: 'Энергия',
    calcCost: 'Стоимость',
    calcTime: 'Время',
    somoniPerKwhShort: 'сом.',
    installApp: 'Установить',
    installHint: 'Добавьте приложение на главный экран',
    // Install instructions, one entry per browser situation.
    install: {
      iosAlt: {
        title: '{browser} на iPhone не умеет устанавливать приложения',
        steps: [
          'Откройте <strong>Safari</strong> на iPhone',
          'Перейдите на этот сайт снова',
          'Нажмите <strong>Поделиться</strong> <span aria-hidden="true">⎋</span> → <strong>«На экран «Домой»»</strong>',
        ],
        note: 'Это ограничение Apple: на iOS только Safari может установить веб-приложение на главный экран',
      },
      ios: {
        title: 'NŪR — iPhone / iPad',
        steps: [
          'Нажмите кнопку <strong>Поделиться</strong> <span aria-hidden="true">⎋</span> внизу экрана',
          'Прокрутите и выберите <strong>«На экран «Домой»»</strong>',
          'Нажмите <strong>«Добавить»</strong> в правом верхнем углу',
        ],
      },
      samsung: {
        title: 'NŪR — Samsung Internet',
        steps: [
          'Откройте меню (иконка <strong>☰</strong> внизу)',
          'Выберите <strong>«Добавить страницу на»</strong>',
          'Нажмите <strong>«Главный экран»</strong>',
        ],
      },
      ffAndroid: {
        title: 'NŪR — Firefox',
        steps: [
          'Откройте меню (три точки <strong>⋮</strong>)',
          'Выберите <strong>«Установить»</strong> или <strong>«Добавить на главный экран»</strong>',
          'Подтвердите установку',
        ],
      },
      ffDesktop: {
        title: 'NŪR — Firefox',
        steps: [
          'Firefox на десктопе пока не поддерживает установку PWA напрямую',
          'Создайте закладку через <strong>Ctrl/Cmd + D</strong>',
          'Или откройте сайт в Chrome/Edge для установки',
        ],
      },
      android: {
        title: 'NŪR — Android',
        steps: [
          'Откройте меню браузера (три точки <strong>⋮</strong>)',
          'Выберите <strong>«Установить приложение»</strong> или <strong>«Добавить на главный экран»</strong>',
          'Подтвердите — NŪR появится как обычное приложение',
        ],
        note: 'Если пункта нет — используйте Chrome или обновите браузер',
      },
      desktop: {
        title: 'NŪR — установка',
        steps: [
          'В адресной строке справа найдите иконку <strong>«Установить»</strong> ⊕',
          'Или откройте меню браузера (⋮) → <strong>«Установить NŪR»</strong>',
          'Нажмите <strong>«Установить»</strong> в диалоговом окне',
        ],
        note: 'Приложение откроется в отдельном окне без адресной строки',
      },
    },
  },
  en: {
    appName: 'NŪR',
    appTagline: 'Dushanbe EV Charging Stations',
    findNearest: 'Find Nearest',
    findNearestShort: 'Find',
    stations: 'Stations',
    freeConnectors: 'Free Connectors',
    allStations: 'All Stations',
    nearest: 'Nearest',
    recommended: 'Recommended',
    distance: 'Distance',
    power: 'Power',
    tariff: 'Tariff',
    schedule: 'Work Hours',
    connector: 'Connector',
    available: 'Available',
    charging: 'Charging',
    chargeLabel: 'Charge',
    occupied: 'Occupied',
    chargeLevel: 'Charge Level',
    navigateTo: 'Show on Map',
    getDirections: 'Directions',
    closePanel: 'Close',
    loading: 'Loading...',
    error: 'Error',
    errorLoading: 'Failed to load data',
    retry: 'Retry',
    locationDenied: 'Location access denied',
    locationUnavailable: 'Location unavailable',
    locationFound: 'Location found',
    locating: 'Locating...',
    locConsentTag: 'On-device',
    locConsentTitle: 'Find charging near you',
    locConsentBody: 'Share your location and NŪR points you to the nearest free charger — and draws the route there.',
    locConsentAllow: 'Allow location',
    locConsentDeny: 'Not now',
    locConsentNote: 'We never store or share where you are.',
    myLocation: 'My Location',
    noFreeStations: 'No free stations',
    noStations: 'No stations',
    bestChoice: 'Best Choice',
    freeNow: 'Available now',
    soonFree: 'Soon available',
    busy: 'Busy',
    somoniPerKwh: 'TJS/kWh',
    meters: 'm',
    km: 'km',
    minSuffix: 'min',
    hrSuffix: 'hr',
    stationDetails: 'Station Details',
    filterAll: 'All',
    filterAvailable: 'Available',
    filter120w: '120W',
    filter60w: '60W',
    totalStations: 'Stations',
    availableNow: 'Free',
    lastUpdate: 'Last Updated',
    searchPlaceholder: 'Search station...',
    walking: 'Walk',
    openNow: 'Open',
    closedUntil: 'Closed until',
    open247: '24/7',
    freeIn: 'Free in about',
    etaSoon: 'Freeing up soon',
    etaSoonShort: 'soon',
    allBusy: 'All connectors occupied',
    occupiedNow: 'Busy',
    notifNotSupported: 'Your browser does not support notifications',
    notifDisabled: 'Notifications disabled',
    notifDenied: 'Please allow notification permissions',
    notifEnabled: 'Notifications enabled',
    notifDisableTitle: 'Disable notifications',
    notifEnableTitle: 'Enable notifications',
    notifTitle: 'Station is now available!',
    routeBuilding: 'Building route...',
    routeReady: 'Route ready',
    routeUpdated: 'Route updated',
    routeError: 'Could not build route',
    routeLabel: 'Route',
    routeCleared: 'Route cleared',
    routeArrived: 'You have arrived 🎉',
    openGoogleMaps: 'Open in Google Maps',
    liveTrackingOn: 'Live tracking enabled',
    liveTrackingOff: 'Live tracking disabled',
    calcEyebrow: 'Calculator',
    calcTitle: 'Charging cost',
    calcStation: 'Station',
    calcSelectStation: 'Select a station',
    calcBattery: 'Vehicle battery',
    calcCurrent: 'Current charge',
    calcTarget: 'Target charge',
    calcTariff: 'Tariff',
    calcPower: 'Power',
    calcEnergy: 'Energy',
    calcCost: 'Cost',
    calcTime: 'Time',
    somoniPerKwhShort: 'TJS',
    installApp: 'Install',
    installHint: 'Add app to home screen',
    // Install instructions, one entry per browser situation.
    install: {
      iosAlt: {
        title: '{browser} on iPhone cannot install apps',
        steps: [
          'Open <strong>Safari</strong> on your iPhone',
          'Visit this site again',
          'Tap <strong>Share</strong> <span aria-hidden="true">⎋</span> → <strong>Add to Home Screen</strong>',
        ],
        note: 'This is an Apple restriction: on iOS only Safari can install a web app to the home screen',
      },
      ios: {
        title: 'NŪR — iPhone / iPad',
        steps: [
          'Tap the <strong>Share</strong> <span aria-hidden="true">⎋</span> button at the bottom of the screen',
          'Scroll down and choose <strong>Add to Home Screen</strong>',
          'Tap <strong>Add</strong> in the top right corner',
        ],
      },
      samsung: {
        title: 'NŪR — Samsung Internet',
        steps: [
          'Open the menu (<strong>☰</strong> at the bottom)',
          'Choose <strong>Add page to</strong>',
          'Tap <strong>Home screen</strong>',
        ],
      },
      ffAndroid: {
        title: 'NŪR — Firefox',
        steps: [
          'Open the menu (three dots <strong>⋮</strong>)',
          'Choose <strong>Install</strong> or <strong>Add to Home screen</strong>',
          'Confirm the installation',
        ],
      },
      ffDesktop: {
        title: 'NŪR — Firefox',
        steps: [
          'Firefox on desktop cannot install PWAs directly yet',
          'Bookmark the page with <strong>Ctrl/Cmd + D</strong>',
          'Or open the site in Chrome/Edge to install it',
        ],
      },
      android: {
        title: 'NŪR — Android',
        steps: [
          'Open the browser menu (three dots <strong>⋮</strong>)',
          'Choose <strong>Install app</strong> or <strong>Add to Home screen</strong>',
          'Confirm — NŪR appears like a regular app',
        ],
        note: 'If you do not see the option, use Chrome or update your browser',
      },
      desktop: {
        title: 'NŪR — Install',
        steps: [
          'Find the <strong>Install</strong> ⊕ icon at the right of the address bar',
          'Or open the browser menu (⋮) → <strong>Install NŪR</strong>',
          'Click <strong>Install</strong> in the dialog',
        ],
        note: 'The app opens in its own window, without an address bar',
      },
    },
  }
};

class I18n {
  constructor() {
    this.currentLang = localStorage.getItem('neru_lang') || 'tj';
  }

  t(key) {
    return translations[this.currentLang]?.[key] || translations.en[key] || key;
  }

  setLang(lang) {
    if (translations[lang]) {
      this.currentLang = lang;
      localStorage.setItem('neru_lang', lang);
      document.documentElement.setAttribute('lang', lang);
      this.updateDOM();
      window.dispatchEvent(new CustomEvent('langchange', { detail: { lang } }));
    }
  }

  getLang() {
    return this.currentLang;
  }

  /**
   * Install instructions for one browser situation, in the active language.
   * Falls back to English so a missing entry still reads as instructions
   * rather than a blank card.
   */
  install(variant) {
    const set = translations[this.currentLang]?.install || {};
    return set[variant] || translations.en.install?.[variant] || null;
  }

  updateDOM() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      el.textContent = this.t(key);
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      const key = el.getAttribute('data-i18n-placeholder');
      el.placeholder = this.t(key);
    });
    document.querySelectorAll('[data-i18n-title]').forEach(el => {
      const key = el.getAttribute('data-i18n-title');
      el.title = this.t(key);
    });
  }
}

const i18n = new I18n();
