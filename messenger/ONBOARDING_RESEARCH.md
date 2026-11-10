# 100 правил низкого порога входа

Для pps: чтобы мессенджером пользовался и десятилетний ребёнок, и человек,
который первый раз видит чат. Каждое правило — из исследований и гайдов
по юзабилити, доступности и обучению.

Источники: Nielsen Norman Group, Baymard, WCAG 2.2, Material Design 3,
Apple HIG, GOV.UK Design System, Microsoft Inclusive Design, Plain Language,
Interaction Design Foundation, ISO 9241-11.

---

## A. Первый запуск

1. Покажи ценность до того, как просишь усилия. [NN/g]
2. Один главный действие на экране. [NN/g]
3. Не показывай всё сразу — раскрывай по шагам. [NN/g progressive disclosure]
4. Дай кнопку «Пропустить». [NN/g onboarding]
5. Онбординг — 3 шага максимум. [NN/g]
6. Показывай реальные экраны, а не абстрактные картинки. [NN/g]
7. Дай попробовать сразу, без туториала. [NN/g]
8. Запоминай, что онбординг пройден. [NN/g]
9. Помощь должна открываться снова из настроек. [NN/g help]
10. Не ставь регистрацию перед первым полезным действием. [Baymard]

## B. Поиск человека

11. Поле поиска подписано «Найди друга по нику». [NN/g forms]
12. Подсказывай формат ника примером. [NN/g]
13. Показывай аватар и «в сети» в результатах. [NN/g]
14. Пустой результат объясняет, что делать. [NN/g empty states]
15. Показывай «ищу…», пока идёт запрос. [NN/g loading]
16. Сначала недавние контакты. [NN/g]
17. QR — альтернатива поиску. [NN/g]
18. Ошибка «ник не найден» с подсказкой. [NN/g errors]
19. Один тап — открыть чат. [Fitts]
20. Не заставляй выбирать из длинного списка. [Hick]

## C. Сообщения

21. Поле ввода всегда внизу. [NN/g mobile]
22. Placeholder с примером: «Напиши сообщение…». [NN/g]
23. Кнопка отправки заметная. [Fitts]
24. Своё сообщение появляется мгновенно. [NN/g response times]
25. Показывай статус: отправка / отправлено. [NN/g visibility]
26. Ошибка — с кнопкой «Повторить». [NN/g errors]
27. Разделяй дни датами. [NN/g]
28. Непрочитанные — цифрой. [NN/g]
29. Кнопка «Вниз», если ушёл в историю. [NN/g]
30. Enter отправляет. [NN/g keyboard]

## D. Фото и файлы

31. Сначала предпросмотр, потом отправка. [NN/g]
32. Одно поле подписи, а не два. [NN/g forms]
33. Подпись — в том же поле, что и сообщение. [Telegram pattern]
34. Можно выбрать несколько фото сразу. [NN/g]
35. Несколько фото — одной группой. [Telegram pattern]
36. Кнопка «Убрать» рядом с превью. [NN/g user control]
37. Лимит размера — простыми словами. [NN/g errors]
38. Показывай «Загружаю…». [NN/g progress]
39. По клику фото открывается больше. [NN/g]
40. Не теряй текст, если передумал. [NN/g error prevention]

## E. Пустые состояния

41. Объясняй, что здесь будет. [NN/g empty states]
42. Одна кнопка действия. [NN/g]
43. Дружелюбный тон, без канцелярита. [Plain Language]
44. Фокус сразу в поиске. [NN/g]
45. Предложи QR и сканер. [NN/g]
46. Не оставляй тупиков. [NN/g]
47. Покажи пример ника. [NN/g]
48. На телефоне — крупно и по центру. [NN/g mobile]
49. Никаких технических терминов. [Plain Language]
50. Ссылка на «Как пользоваться». [NN/g help]

## F. Язык и подписи

51. Пиши простыми словами. [Plain Language]
52. На кнопках — глаголы: «Отправить», «Позвонить». [NN/g]
53. Не говори «акцент», «контакты», «сессия». [Plain Language]
54. Один и тот же термин везде. [NN/g consistency]
55. Короткие предложения. [Plain Language]
56. Не показывай коды ошибок. [NN/g errors]
57. Весь интерфейс — на одном языке. [NN/g]
58. Объясняй последствия: «удалится у обоих». [NN/g]
59. Опасные действия — с подтверждением. [NN/g]
60. Обращение на «ты», без официоза. [Plain Language]

## G. Телефон и доступность

61. Кнопки не меньше 44×44. [WCAG 2.2 / Apple HIG]
62. Главные кнопки — в зоне большого пальца. [NN/g thumb zone]
63. Учитывай «чёлку» и жесты. [Apple HIG]
64. Шрифт не меньше 14–16 px. [WCAG]
65. Контраст текста 4.5:1. [WCAG]
66. Уважай «уменьшить движение». [WCAG]
67. Подписи для screen reader. [WCAG]
68. Видимый фокус с клавиатуры. [WCAG]
69. Не прячь действия только в hover. [NN/g]
70. Проверяй альбомную ориентацию. [NN/g responsive]

## H. Ошибки и восстановление

71. Ошибка — рядом с полем. [NN/g]
72. Говори, что сделать, а не что сломалось. [NN/g]
73. Сохраняй введённый текст. [NN/g]
74. Дай кнопку «Повторить». [NN/g]
75. Показывай «нет связи». [NN/g]
76. Сессия истекла — веди на вход. [NN/g]
77. Файл не загрузился — не теряй превью. [NN/g]
78. Удаление — с подтверждением. [NN/g]
79. Не молчи при ошибке. [NN/g]
80. Для поддержки — понятный текст, не stack trace. [NN/g]

## I. Доверие и приватность

81. Объясняй, кто видит сообщения. [NN/g privacy]
82. Показывай «в сети» честно. [NN/g]
83. Разрешения проси с контекстом. [NN/g permissions]
84. Уведомления — только по согласию. [NN/g]
85. Никаких тёмных паттернов. [NN/g ethics]
86. Выход — в два клика. [NN/g]
87. Объясняй, что значит «удалить чат». [NN/g]
88. Где хранятся фото — простыми словами. [Plain Language]
89. Контент и тон — уместные для школьников. [NN/g children]
90. Никаких скрытых платежей. [NN/g trust]

## J. Дети и низкая цифровая грамотность

91. Одна мысль на экран. [NN/g low literacy]
92. Иконка + текст, не только иконка. [NN/g]
93. Никаких аббревиатур. [Plain Language]
94. Примеры вместо объяснений. [NN/g]
95. Ошибка не должна пугать. [NN/g]
96. Мгновенная реакция на действие. [NN/g]
97. Одинаковые элементы на всех экранах. [NN/g consistency]
98. Крупные зоны нажатия. [WCAG]
99. Короткий онбординг, который можно перечитать. [NN/g]
100. Тестируй на ребёнке или новичке, а не на себе. [NN/g usability testing]

---

## Что из этого уже внедрено в pps (v26)

| Правило | Где |
|---|---|
| 31–33 | Фото: превью, одна подпись в основном поле, без второго input |
| 34–35 | Мультивыбор фото и группировка в альбом |
| 36 | Кнопка «×» у превью |
| 38 | «Загружаю…» на кнопке |
| 39 | Клик по фото открывает оригинал |
| 5–9, 50 | Экран «Как пользоваться» с 3 шагами и кнопкой в настройках |
| 22 | Placeholder «Напиши сообщение…» |
| 41–45 | Пустой экран с поиском, QR и сканером |
| 51–60 | Простые подписи, «ты», без кодов ошибок |
| 61–70 | Крупные кнопки, safe-area, reduced motion, aria-label |
| 71–79 | Понятные ошибки, повтор, сохранение текста |

## Что ещё стоит сделать

- Онбординг с реальным примером: «Вот Ник, нажми на него».
- Кнопка «Помощь» на главном экране, а не только в настройках.
- Подсказка при первом сообщении: «Напиши и нажми самолётик».
- Тест с 2–3 школьниками: где застревают.
- Упростить удаление чата: два понятных варианта вместо `confirm`.

## Ссылки на источники

- Nielsen Norman Group — https://www.nngroup.com/articles/
- NN/g 10 heuristics — https://www.nngroup.com/articles/ten-usability-heuristics/
- NN/g empty states — https://www.nngroup.com/articles/empty-state-interface-design/
- NN/g errors — https://www.nngroup.com/articles/error-message-guidelines/
- NN/g onboarding — https://www.nngroup.com/articles/onboarding-tutorials/
- NN/g children — https://www.nngroup.com/articles/children-ux/
- NN/g low literacy — https://www.nngroup.com/articles/low-literacy-users/
- NN/g Fitts — https://www.nngroup.com/articles/fitts-law/
- NN/g Hick — https://www.nngroup.com/articles/hicks-law/
- NN/g progressive disclosure — https://www.nngroup.com/articles/progressive-disclosure/
- NN/g response times — https://www.nngroup.com/articles/response-times-3-important-limits/
- NN/g mobile touch targets — https://www.nngroup.com/articles/mobile-touch-targets/
- WCAG 2.2 — https://www.w3.org/WAI/WCAG22/quickref/
- WCAG target size — https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html
- WCAG contrast — https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html
- W3C COGA — https://www.w3.org/WAI/standards-guidelines/coga/
- Material Design 3 — https://m3.material.io/
- Apple HIG — https://developer.apple.com/design/human-interface-guidelines/
- GOV.UK Design System — https://design-system.service.gov.uk/
- GOV.UK error messages — https://design-system.service.gov.uk/patterns/error-messages/
- Microsoft Inclusive Design — https://inclusive.microsoft.design/
- Plain Language — https://plainlanguage.gov/guidelines/
- Baymard — https://baymard.com/blog
- Interaction Design Foundation — https://www.interaction-design.org/literature
- ISO 9241-11 — https://www.iso.org/standard/63500.html
- Smashing Magazine onboarding — https://www.smashingmagazine.com/2018/01/onboarding-ux/
- Smashing Magazine empty states — https://www.smashingmagazine.com/2022/08/empty-states-ux/
- A List Apart — https://alistapart.com/
- Usability.gov — https://www.usability.gov/
