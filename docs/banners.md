# NŪR — промпты для баннеров

Шесть баннеров: **один стиль, разные темы**. Единство держится не темой, а
блоком Style DNA — он копируется в каждый промпт дословно, без изменений. Меняется
только описание сюжета.

Промпты на английском: модели генерации изображений понимают его заметно точнее.

---

## Куда это ставится

| Баннер | Где | Формат |
|---|---|---|
| 1. Проспект на рассвете | 01 Вход, фон верхней трети | 3:4 |
| 2. Разъём | Промо-карточка «Зарядки» | 2:1 |
| 3. Парковка утром | Промо-карточка «Паркинг» | 2:1 |
| 4. Город и горы | Онбординг, экран приветствия | 3:4 |
| 5. Ночная смена | Стор, первый скриншот | 9:16 |
| 6. Станция днём | Промо, партнёрские станции | 2:1 |

На карту, список и настройки баннеры не ставим — там они станут шумом.

---

## Style DNA — копировать в каждый промпт без правок

```
Shot on a full-frame camera with a 50mm lens at f/2.8, natural available light,
documentary photography, calm and restrained. Muted desaturated palette of warm
greys, off-white and soft asphalt tones, with exactly one accent of deep
electric blue. Soft blue-hour or lightly overcast light, no harsh sun. Fine film
grain, gentle vignette, true-to-life colour, no HDR. Generous empty negative
space in the upper third of the frame for a text overlay. Central Asian city,
Dushanbe, Tajikistan.
```

Ключевое здесь — **«одна синяя акцентная точка»** и **«пустое место в верхней
трети»**. Первое связывает баннеры с интерфейсом, где синий означает зарядку.
Второе даёт место под заголовок, иначе текст ляжет поверх сюжета.

---

## Negative prompt — тоже во все

```
no text, no letters, no words, no logos, no watermarks, no signage with
readable writing, no human faces, no people looking at camera, no oversaturated
colours, no neon, no lens flare, no HDR, no tilt-shift, no fisheye, no CGI look,
no 3D render, no illustration, no cartoon, no stock-photo smiling, no clutter,
no motion blur on the main subject
```

---

## 1 · Проспект на рассвете — экран входа

```
A wide empty avenue in Dushanbe at first light, seen from low inside a car
through the windscreen. Tall plane trees line both sides and arch over the road,
their trunks pale and mottled. Wet asphalt holds a soft reflection. Far down the
street a single small deep-electric-blue traffic signal glows — the only
saturated colour in the frame. Empty sky fills the upper third.
```
Формат `3:4`. Верх остаётся под логотип и заголовок «Вход по номеру».

---

## 2 · Разъём — промо зарядок

```
Extreme close-up of a CCS2 fast-charging connector locked into the charging port
of a dark grey car, shot from a low three-quarter angle. Thick black cable
curves out of frame. A single deep-electric-blue indicator light glows on the
connector housing. Background is a softly blurred empty concrete forecourt.
Shallow depth of field, the connector sharp, everything behind it dissolved.
```
Формат `2:1`. Единственная синяя точка — индикатор.

---

## 3 · Парковка утром — промо паркинга

```
An empty paid parking lot early in the morning, photographed from a slightly
elevated angle so the painted white bay lines run as clean diagonals across the
frame. Wet grey asphalt, long soft shadows, low warm sun behind thin cloud. One
lone dark car parked far to the right edge. A small deep-electric-blue parking
meter stands in the middle distance. Wide empty sky above.
```
Формат `2:1`. Геометрия разметки — главный сюжет.

---

## 4 · Город и горы — онбординг

```
Dushanbe seen from a quiet residential rooftop at dawn, low Soviet-modernist
apartment blocks in warm pale concrete spreading toward the horizon, with the
Hisor mountain range rising behind them in layered blue-grey haze. A single
deep-electric-blue rooftop water tank catches the light in the middle ground.
Soft morning mist between the buildings. The upper third is open sky.
```
Формат `3:4`. Даёт ощущение места — не абстрактный «город».

---

## 5 · Ночная смена — скриншот в сторе

```
The interior of a car at night from the back seat, looking forward past the
driver's shoulder — head and face out of frame, only the shoulder and the
steering wheel visible in silhouette. Through the windscreen a quiet city street
dissolves into soft round bokeh of streetlights. The dashboard reads as dark
matte shapes with one small deep-electric-blue instrument glow. Deep shadows,
very little light, calm rather than dramatic.
```
Формат `9:16`. Лицо намеренно за кадром — модели плохо рисуют лица, и это
избавляет от вопроса о согласии на съёмку.

---

## 6 · Станция днём — партнёрские точки

```
A modern EV charging station under a simple flat canopy, photographed straight
on from a distance so the composition reads as clean horizontal bands: pale
concrete ground, dark charging posts, white canopy, overcast sky. Two charging
posts stand in the frame, each with one small deep-electric-blue status light.
No cars. Architectural, symmetric, almost still-life.
```
Формат `2:1`. Симметрия сознательно — перекликается с симметрией интерфейса.

---

## Практика

**Кириллицу в изображение не просить.** Модели генерации рисуют кириллицу
нечитаемым мусором — отсюда `no text` в негативе. Весь текст накладывается в
приложении, где он ещё и переводится на три языка. Изображение с вшитой
надписью пришлось бы генерировать трижды.

**Держать серию.** Если генератор поддерживает seed — зафиксировать один и
менять только сюжет. В Midjourney добавлять `--style raw --ar 2:1` и, для
единства, `--sref` со ссылкой на первый удачный кадр.

**Проверять на светлом фоне.** Приложение белое. Баннер, красивый сам по себе,
на `#FAFAF9` часто оказывается слишком тёмным или слишком контрастным.
Смотреть в макете, а не в галерее.

**Читаемость поверх.** Если заголовок ложится на изображение, нужен градиент
от белого снизу или затемнение сверху — иначе текст утонет. Проверять на
самом светлом и самом тёмном участке кадра.

**Вес.** Баннер в приложении — WebP, ширина не больше 1080px. Исходники
складывать отдельно, в бандл они не идут.
