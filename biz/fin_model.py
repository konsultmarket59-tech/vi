"""Финансовая модель «Логика Дома» на 3 года: python3 biz/fin_model.py → biz/finmodel-logika-doma.xlsx (формулы; пересчёт — recalc LibreOffice)."""
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.utils import get_column_letter as L
import os

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'finmodel-logika-doma.xlsx')
wb = Workbook()
F = 'Arial'
BLUE = Font(name=F, color='0000FF'); BLK = Font(name=F); BOLD = Font(name=F, bold=True); GREEN = Font(name=F, color='008000')
H = Font(name=F, bold=True, color='FFFFFF'); HF = PatternFill('solid', fgColor='19317B'); YEL = PatternFill('solid', fgColor='FFFF00'); SUB = PatternFill('solid', fgColor='E9EEF8')
RUB = '#,##0;(#,##0);-'; PCT = '0.0%;(0.0%);-'; NUM = '#,##0;(#,##0);-'
NOTE = Font(name=F, color='5B6272', size=9)

# ---------- Допущения ----------
A = wb.active; A.title = 'Допущения'
A['A1'] = 'Финансовая модель «Логика Дома» на 3 года — допущения'; A['A1'].font = Font(name=F, bold=True, size=14)
A['A2'] = 'Синие числа — допущения, их можно менять; жёлтые — ключевые. Все остальные листы считаются формулами.'; A['A2'].font = Font(name=F, italic=True, color='5B6272')
rows = []
def sec(t): rows.append(('', t, None, None, None, False))
def a(k, t, v, f, note, key=False): rows.append((k, t, v, f, note, key))
sec('Трафик и спрос')
a('vis0', 'Посетителей сайта в 1-й месяц', 3000, NUM, 'Старт: SEO-страницы проектов, статьи, соцсети, реклама. Оценка модели — уточняйте по Метрике.', True)
a('g1', 'Рост посетителей в месяц, 1-й год', 0.15, PCT, 'Быстрый рост на старте за счёт рекламы и SEO.', True)
a('g2', 'Рост посетителей в месяц, 2-й год', 0.06, PCT, 'Оценка модели.')
a('g3', 'Рост посетителей в месяц, 3-й год', 0.03, PCT, 'Оценка модели; выход в соседние регионы.')
a('cUse', 'Доля посетителей, работающих в конструкторе', 0.30, PCT, 'Конструктор — главная точка входа на сайт.')
a('cReg', 'Доля зарегистрировавшихся в личном кабинете', 0.12, PCT, 'Из работавших в конструкторе: сохранение проекта и подарочная визуализация.', True)
a('cSave', 'Доля сохранивших проект', 0.10, PCT, 'Из работавших в конструкторе.', True)
a('cLead', 'Доля оставивших заявку на подбор подрядчика', 0.025, PCT, 'Из работавших в конструкторе.', True)
sec('Конверсия в платные услуги (из сохранивших проект)')
a('cEp', 'Покупают эскизный проект PDF', 0.05, PCT, 'Оценка модели.')
a('cCad', 'Покупают файлы для ArchiCAD', 0.02, PCT, 'В основном архитекторы и те, у кого свой архитектор.')
a('cVer', 'Заказывают верификацию', 0.015, PCT, 'Оценка модели.')
a('cAkr', 'Заказывают АКР', 0.004, PCT, 'Оценка модели; часть — после верификации.')
sec('Реалистичные визуализации (рендер)')
a('vWel', 'Подарок при регистрации, визуализаций', 1, NUM, 'Настройка CRM «Подарок за регистрацию» (по решению владельца — 1).')
a('cWel', 'Доля зарегистрированных, использующих подарок', 0.70, PCT, 'Оценка модели.')
a('cP3', 'Покупают пакет из 3 визуализаций, доля зарегистрированных', 0.06, PCT, 'Оценка модели.', True)
a('cP5', 'Покупают пакет из 5 визуализаций, доля зарегистрированных', 0.04, PCT, 'Оценка модели.', True)
a('kRep', 'Покупок пакета на одного покупателя', 1.3, '0.0', 'Повторные покупки: другие ракурсы, интерьеры.')
a('pP3', 'Цена пакета из 3 визуализаций', 150, RUB, 'Пакеты по решению владельца: 3 и 5 визуализаций, ≈ 50 ₽ за штуку.')
a('pP5', 'Цена пакета из 5 визуализаций', 250, RUB, 'Пакеты по решению владельца: 3 и 5 визуализаций.')
a('vRen', 'Себестоимость одной визуализации (API «Пользы»)', 6, RUB, '≈ 4 ₽ за генерацию + повторы и возвраты при неудаче.')
a('kUse', 'Доля купленных визуализаций, которые используют', 0.9, PCT, 'Часть остаётся на балансе.')
sec('Заявки на подбор подрядчика')
a('cRep', 'Выбирают «Рассылка и отчёт»', 0.30, PCT, 'Из заявок.')
a('cFull', 'Выбирают «Полное сопровождение»', 0.08, PCT, 'Из заявок.')
a('cSold', 'Заявки, проданные строительным компаниям', 0.40, PCT, 'Контакты по услуге «рассылка и отчёт» и бесплатные обращения — по сетке цен.')
a('cHot', 'Сделки с СК через платформу («горячий клиент»)', 0.03, PCT, 'Из заявок: созвон, согласованная цена, договор.', True)
sec('Цены, ₽ (по сайту)')
a('pEp', 'Эскизный проект PDF', 3000, RUB, 'Цена с сайта (решение владельца).')
a('pCad', 'Файлы для ArchiCAD', 3000, RUB, 'Цена с сайта (решение владельца).')
a('pVer', 'Верификация', 15000, RUB, 'Цена с сайта.')
a('pAkr', 'АКР, средний чек', 75000, RUB, 'На сайте «от 50 000 ₽»; средний чек — оценка модели.')
a('pRep', 'Рассылка и отчёт', 1500, RUB, 'Цена с сайта (решение владельца).')
a('pFull', 'Полное сопровождение', 14900, RUB, 'Цена с сайта; СК компенсирует клиенту при договоре.')
a('pLead', 'Цена заявки для СК, средняя', 2500, RUB, 'По сетке цены лида в CRM — уточните.')
a('pHome', 'Средняя стоимость домовладения', 7000000, RUB, 'Оценка модели для Перми.')
a('kHot', 'Вознаграждение за горячего клиента', 0.02, PCT, 'Оферта для компаний: 2 % стоимости домовладения.', True)
sec('Переменные расходы')
a('vVer', 'Архитектор за верификацию, доля цены', 0.50, PCT, 'Если архитектор не в штате — по договору.')
a('vAkr', 'Архитектор и конструктор за АКР, доля цены', 0.60, PCT, 'Оценка модели.')
a('vAcq', 'Эквайринг, доля оплат клиентов', 0.03, PCT, 'ЮKassa / Т-Банк: 2,5–3,5 %.')
a('tax', 'Налог УСН «доходы»', 0.06, PCT, 'ИП на УСН 6 %; взносы ИП за себя — в постоянных расходах.')
sec('Постоянные расходы, ₽ в месяц')
a('fHost', 'Сервер, домен, резервные копии', 15000, RUB, 'VPS в России + хранение файлов.')
a('fSoft', 'Сервисы: почта, телефония, уведомления', 10000, RUB, 'Оценка модели.')
a('fOther', 'Прочее: бухгалтерия, банк, офис', 25000, RUB, 'Оценка модели.')
a('fIp', 'Взносы ИП за себя (в среднем в месяц)', 5000, RUB, 'Фиксированные взносы ≈ 54 тыс. ₽ в год; 1 % с дохода свыше 300 тыс. ₽ не учтён (уменьшает налог УСН).')
a('m1', 'Маркетинг, 1-й год', 150000, RUB, 'Яндекс Директ, ВК, блогеры.', True)
a('m2', 'Маркетинг, 2-й год', 300000, RUB, 'Оценка модели.')
a('m3', 'Маркетинг, 3-й год', 400000, RUB, 'Оценка модели.')
a('kSal', 'Начисления на зарплату (страховые взносы)', 0.30, PCT, 'Взносы работодателя ≈ 30 %.')
r = 4; ref = {}
for k, t, v, f, note, key in rows:
    if not k:
        A.cell(r, 1, t).font = BOLD
        for c in (1, 2, 3): A.cell(r, c).fill = SUB
        r += 1; continue
    A.cell(r, 1, t).font = BLK; c = A.cell(r, 2, v); c.font = BLUE; c.number_format = f
    if key: c.fill = YEL
    A.cell(r, 3, note).font = NOTE
    ref[k] = "Допущения!$B$%d" % r; r += 1
A.column_dimensions['A'].width = 58; A.column_dimensions['B'].width = 14; A.column_dimensions['C'].width = 90

# ---------- Штат ----------
S = wb.create_sheet('Штат')
S['A1'] = 'Штат и зарплаты (до вычета НДФЛ, ₽ в месяц); численность — по годам'; S['A1'].font = Font(name=F, bold=True, size=13)
for i, h in enumerate(['Роль', 'Оклад, ₽/мес', '1-й год', '2-й год', '3-й год', 'Что делает'], 1):
    c = S.cell(3, i, h); c.font = H; c.fill = HF
staff = [('Менеджер по клиентам', 70000, 1, 2, 3, 'Заявки, созвоны, отчёты, полное сопровождение, договоры с СК'),
         ('Сметчик', 60000, 0.5, 1, 1, 'Расчёты, сравнение смет и технологий'),
         ('Маркетолог', 70000, 1, 1, 1, 'Контент, SEO, реклама, соцсети'),
         ('Архитектор (в штате)', 90000, 0, 1, 2, 'Верификация, правки, посадка на участок; с 2-го года вместо подряда'),
         ('Разработчик (поддержка сайта)', 120000, 0.5, 0.5, 1, 'Доработки и поддержка платформы'),
         ('Менеджер по работе с СК', 70000, 0, 1, 1, 'Подключение компаний, оплата заявок')]
for j, (n, sal, y1, y2, y3, d) in enumerate(staff):
    rr = 4 + j; S.cell(rr, 1, n).font = BLK
    for col, v in ((2, sal), (3, y1), (4, y2), (5, y3)):
        c = S.cell(rr, col, v); c.font = BLUE; c.number_format = RUB if col == 2 else '0.0'
    S.cell(rr, 6, d).font = NOTE
last = 4 + len(staff) - 1
S.cell(last + 1, 1, 'Человек в штате').font = BOLD
S.cell(last + 2, 1, 'Фонд оплаты с взносами, ₽ в месяц').font = BOLD
for col in (3, 4, 5):
    cl = L(col)
    c = S.cell(last + 1, col, f'=SUM({cl}4:{cl}{last})'); c.number_format = '0.0'; c.font = BOLD
    c = S.cell(last + 2, col, f'=SUMPRODUCT($B$4:$B${last},{cl}4:{cl}{last})*(1+{ref["kSal"]})'); c.number_format = RUB; c.font = BOLD
S['A%d' % (last + 4)] = 'Доля ставки 0,5 — частичная занятость или совмещение. Владелец (ИП) в штат не включён: его доход — прибыль.'; S['A%d' % (last + 4)].font = NOTE
S.column_dimensions['A'].width = 34; S.column_dimensions['F'].width = 70
for c in 'BCDE': S.column_dimensions[c].width = 14
FOT = {y: f"Штат!${'CDE'[y - 1]}${last + 2}" for y in (1, 2, 3)}

# ---------- Помесячно ----------
M = wb.create_sheet('Помесячно')
M['A1'] = 'Помесячный расчёт, 36 месяцев (₽)'; M['A1'].font = Font(name=F, bold=True, size=13)
lines = [
 ('mon', 'Месяц'), ('yr', 'Год'), ('', 'Спрос'),
 ('vis', 'Посетители'), ('use', 'Работали в конструкторе'), ('reg', 'Зарегистрировались'), ('save', 'Сохранили проект'), ('lead', 'Заявки на подбор подрядчика'),
 ('', 'Продажи, шт.'),
 ('nEp', 'Эскизные проекты PDF'), ('nCad', 'Файлы для ArchiCAD'), ('nVer', 'Верификации'), ('nAkr', 'АКР'),
 ('nWel', 'Подарочные визуализации (использованы)'), ('nP3', 'Пакеты из 3 визуализаций'), ('nP5', 'Пакеты из 5 визуализаций'), ('nRen', 'Визуализаций сгенерировано всего'),
 ('nRep', 'Рассылка и отчёт'), ('nFull', 'Полное сопровождение'), ('nSold', 'Заявки, проданные СК'), ('nHot', 'Сделки с СК (горячие клиенты)'),
 ('', 'Выручка, ₽'),
 ('rEp', 'Эскизные проекты PDF'), ('rCad', 'Файлы для ArchiCAD'), ('rVer', 'Верификация'), ('rAkr', 'АКР'), ('rP3', 'Пакеты из 3 визуализаций'), ('rP5', 'Пакеты из 5 визуализаций'),
 ('rRep', 'Рассылка и отчёт'), ('rFull', 'Полное сопровождение'), ('rLead', 'Продажа заявок СК'), ('rHot', 'Вознаграждение за горячих клиентов'),
 ('rev', 'Выручка всего'), ('', 'Расходы, ₽'),
 ('cArch', 'Архитекторы и конструкторы по заказам'), ('cViz', 'API визуализаций (подарочные и платные)'), ('cAcq', 'Эквайринг'), ('cTax', 'Налог УСН'),
 ('cFot', 'Зарплата с взносами'), ('cMkt', 'Маркетинг'), ('cFix', 'Сервер, сервисы, прочее, взносы ИП'),
 ('cost', 'Расходы всего'), ('prof', 'Прибыль (убыток)'), ('cum', 'Накопленный результат'),
]
row = {}; r = 3
for k, t in lines:
    c = M.cell(r, 1, t)
    if not k: c.font = BOLD; c.fill = SUB
    else: c.font = BOLD if k in ('rev', 'cost', 'prof', 'cum') else BLK
    if k: row[k] = r
    r += 1
R = lambda k, col: f'{L(col)}{row[k]}'
for m in range(1, 37):
    col = m + 1; cl = L(col)
    M.cell(row['mon'], col, m).font = BOLD
    M.cell(row['yr'], col, f'=INT(({cl}{row["mon"]}-1)/12)+1')
    yr = f'{cl}{row["yr"]}'
    g = f'CHOOSE({yr},{ref["g1"]},{ref["g2"]},{ref["g3"]})'
    M.cell(row['vis'], col, f'={ref["vis0"]}' if m == 1 else f'={L(col-1)}{row["vis"]}*(1+{g})')
    M.cell(row['use'], col, f'={R("vis",col)}*{ref["cUse"]}')
    M.cell(row['reg'], col, f'={R("use",col)}*{ref["cReg"]}')
    M.cell(row['save'], col, f'={R("use",col)}*{ref["cSave"]}')
    M.cell(row['lead'], col, f'={R("use",col)}*{ref["cLead"]}')
    for n, cv in (('nEp', 'cEp'), ('nCad', 'cCad'), ('nVer', 'cVer'), ('nAkr', 'cAkr')):
        M.cell(row[n], col, f'={R("save",col)}*{ref[cv]}')
    M.cell(row['nWel'], col, f'={R("reg",col)}*{ref["cWel"]}*{ref["vWel"]}')
    M.cell(row['nP3'], col, f'={R("reg",col)}*{ref["cP3"]}*{ref["kRep"]}')
    M.cell(row['nP5'], col, f'={R("reg",col)}*{ref["cP5"]}*{ref["kRep"]}')
    M.cell(row['nRen'], col, f'={R("nWel",col)}+({R("nP3",col)}*3+{R("nP5",col)}*5)*{ref["kUse"]}')
    for n, cv in (('nRep', 'cRep'), ('nFull', 'cFull'), ('nSold', 'cSold'), ('nHot', 'cHot')):
        M.cell(row[n], col, f'={R("lead",col)}*{ref[cv]}')
    for rv, n, pr in (('rEp', 'nEp', 'pEp'), ('rCad', 'nCad', 'pCad'), ('rVer', 'nVer', 'pVer'), ('rAkr', 'nAkr', 'pAkr'), ('rP3', 'nP3', 'pP3'), ('rP5', 'nP5', 'pP5'), ('rRep', 'nRep', 'pRep'), ('rFull', 'nFull', 'pFull'), ('rLead', 'nSold', 'pLead')):
        M.cell(row[rv], col, f'={R(n,col)}*{ref[pr]}')
    M.cell(row['rHot'], col, f'={R("nHot",col)}*{ref["pHome"]}*{ref["kHot"]}')
    M.cell(row['rev'], col, f'=SUM({cl}{row["rEp"]}:{cl}{row["rHot"]})')
    M.cell(row['cArch'], col, f'={R("rVer",col)}*{ref["vVer"]}*IF({yr}=1,1,0.4)+{R("rAkr",col)}*{ref["vAkr"]}')
    M.cell(row['cViz'], col, f'={R("nRen",col)}*{ref["vRen"]}')
    M.cell(row['cAcq'], col, f'=SUM({cl}{row["rEp"]}:{cl}{row["rFull"]})*{ref["vAcq"]}')
    M.cell(row['cTax'], col, f'={R("rev",col)}*{ref["tax"]}')
    M.cell(row['cFot'], col, f'=CHOOSE({yr},{FOT[1]},{FOT[2]},{FOT[3]})')
    M.cell(row['cMkt'], col, f'=CHOOSE({yr},{ref["m1"]},{ref["m2"]},{ref["m3"]})')
    M.cell(row['cFix'], col, f'={ref["fHost"]}+{ref["fSoft"]}+{ref["fOther"]}+{ref["fIp"]}')
    M.cell(row['cost'], col, f'=SUM({cl}{row["cArch"]}:{cl}{row["cFix"]})')
    M.cell(row['prof'], col, f'={R("rev",col)}-{R("cost",col)}')
    M.cell(row['cum'], col, f'={R("prof",col)}' if m == 1 else f'={L(col-1)}{row["cum"]}+{R("prof",col)}')
    for k, rr in row.items():
        if k in ('mon', 'yr'): continue
        c = M.cell(rr, col); c.number_format = NUM if rr < row['rEp'] else RUB
        c.font = BOLD if k in ('rev', 'cost', 'prof', 'cum') else (GREEN if k in ('cFot',) else BLK)
M.column_dimensions['A'].width = 44
for col in range(2, 38): M.column_dimensions[L(col)].width = 11
M.freeze_panes = 'B5'
M['A%d' % (row['cum'] + 2)] = 'Архитекторы по заказам: в 1-й год верификацию делает подрядчик (50 % цены), со 2-го года — в основном штатный архитектор (доля подряда 40 %).'; M['A%d' % (row['cum'] + 2)].font = NOTE

# ---------- Итоги ----------
Y = wb.create_sheet('Итоги', 0)
Y['A1'] = 'Логика Дома — финансовая модель на 3 года'; Y['A1'].font = Font(name=F, bold=True, size=15, color='19317B')
Y['A2'] = 'Сводка по годам; все цифры считаются из листов «Допущения», «Штат», «Помесячно». ₽.'; Y['A2'].font = Font(name=F, italic=True, color='5B6272')
for i, h in enumerate(['Показатель', '1-й год', '2-й год', '3-й год', 'Итого 3 года'], 1):
    c = Y.cell(4, i, h); c.font = H; c.fill = HF; c.alignment = Alignment(horizontal='center')
items = [('Посетители сайта', 'vis', NUM), ('Регистрации в личном кабинете', 'reg', NUM), ('Сохранённые проекты', 'save', NUM), ('Заявки на подбор подрядчика', 'lead', NUM),
         ('Эскизные проекты PDF, шт.', 'nEp', NUM), ('Файлы для ArchiCAD, шт.', 'nCad', NUM), ('Верификации, шт.', 'nVer', NUM), ('АКР, шт.', 'nAkr', NUM),
         ('Подарочные визуализации, шт.', 'nWel', NUM), ('Пакеты визуализаций 3 + 5, шт.', 'nP3+nP5', NUM), ('Визуализаций сгенерировано, шт.', 'nRen', NUM), ('Сделки с СК через платформу, шт.', 'nHot', NUM),
         (None, 'Выручка', None),
         ('Эскизные проекты PDF', 'rEp', RUB), ('Файлы для ArchiCAD', 'rCad', RUB), ('Верификация', 'rVer', RUB), ('АКР', 'rAkr', RUB), ('Пакеты из 3 визуализаций', 'rP3', RUB), ('Пакеты из 5 визуализаций', 'rP5', RUB),
         ('Рассылка и отчёт', 'rRep', RUB), ('Полное сопровождение', 'rFull', RUB), ('Продажа заявок СК', 'rLead', RUB), ('Вознаграждение за горячих клиентов', 'rHot', RUB), ('Выручка всего', 'rev', RUB),
         (None, 'Расходы', None),
         ('Архитекторы и конструкторы по заказам', 'cArch', RUB), ('API визуализаций (подарочные и платные)', 'cViz', RUB), ('Эквайринг', 'cAcq', RUB), ('Налог УСН 6 %', 'cTax', RUB), ('Зарплата с взносами', 'cFot', RUB), ('Маркетинг', 'cMkt', RUB), ('Сервер, сервисы, прочее', 'cFix', RUB), ('Расходы всего', 'cost', RUB),
         ('Прибыль (убыток)', 'prof', RUB)]
r = 5; yrow = {}
YR = f'Помесячно!$B${row["yr"]}:$AK${row["yr"]}'
for label, k, f in items:
    if label is None:
        Y.cell(r, 1, k).font = BOLD
        for cc in range(1, 6): Y.cell(r, cc).fill = SUB
        r += 1; continue
    big = k in ('rev', 'cost', 'prof')
    Y.cell(r, 1, label).font = BOLD if big else BLK
    for y in (1, 2, 3):
        fml = '=' + '+'.join(f'SUMIF({YR},{y},Помесячно!$B${row[kk]}:$AK${row[kk]})' for kk in k.split('+'))
        c = Y.cell(r, 1 + y, fml); c.number_format = f; c.font = Font(name=F, color='008000', bold=big)
    c = Y.cell(r, 5, f'=SUM(B{r}:D{r})'); c.number_format = f; c.font = BOLD if big else BLK
    yrow[k] = r; r += 1
Y.cell(r, 1, 'Рентабельность по прибыли').font = BLK
for col in 'BCDE':
    c = Y[f'{col}{r}']; c.value = f'=IF({col}{yrow["rev"]}=0,0,{col}{yrow["prof"]}/{col}{yrow["rev"]})'; c.number_format = PCT
r += 1
Y.cell(r, 1, 'Накопленный результат на конец года').font = BLK
for y in (1, 2, 3):
    c = Y.cell(r, 1 + y, f'=INDEX(Помесячно!$B${row["cum"]}:$AK${row["cum"]},{12 * y})'); c.number_format = RUB; c.font = GREEN
r += 1
Y.cell(r, 1, 'Человек в штате').font = BLK
for y in (1, 2, 3):
    c = Y.cell(r, 1 + y, f'=Штат!{"CDE"[y - 1]}{last + 1}'); c.number_format = '0.0'; c.font = GREEN
r += 1
Y.cell(r, 1, 'Визуализации: выручка минус себестоимость API').font = BLK
for col in 'BCDE':
    c = Y[f'{col}{r}']; c.value = f'={col}{yrow["rP3"]}+{col}{yrow["rP5"]}-{col}{yrow["cViz"]}'; c.number_format = RUB
r += 1
Y.cell(r, 1, 'Максимальная потребность в деньгах (самый глубокий минус)').font = BOLD
c = Y.cell(r, 5, f'=-MIN(0,MIN(Помесячно!$B${row["cum"]}:$AK${row["cum"]}))'); c.number_format = RUB; c.font = BOLD
r += 1
Y.cell(r, 1, 'Месяц выхода в плюс по накопленному результату').font = BOLD
CUM, MON = f'Помесячно!$B${row["cum"]}:$AK${row["cum"]}', f'Помесячно!$B${row["mon"]}:$AK${row["mon"]}'
c = Y.cell(r, 5, f'=IFERROR(INDEX({MON},MATCH(1,INDEX(({CUM}>0)*({MON}>=MATCH(MIN({CUM}),{CUM},0)),0),0)),"после 36-го")'); c.font = BOLD
r += 2
for t in ['Как читать: синие числа на листах «Допущения» и «Штат» — оценки модели, их нужно уточнять по фактической статистике (Метрика, CRM). Жёлтые — сильнее всего влияют на результат.',
          'Визуализации: 1 подарочная при регистрации (расход ≈ 6 ₽) и пакеты из 3 и 5 штук. Сами по себе дают небольшую выручку, но приводят людей к регистрации и платным выгрузкам.',
          'Главный рычаг дохода — сделки с СК через платформу (2 % стоимости дома) и АКР; платные выгрузки и отчёты окупают маркетинг и дают поток клиентов.',
          'Налог: ИП на УСН «доходы» 6 %. 1 % взносов с дохода свыше 300 тыс. ₽ не учтён — им можно уменьшить налог по правилам УСН.',
          '«Полное сопровождение» 14 900 ₽ платит клиент, строительная компания компенсирует ему эту сумму при договоре — для платформы это выручка.']:
    Y.cell(r, 1, t).font = NOTE; r += 1
Y.column_dimensions['A'].width = 60
for c in 'BCDE': Y.column_dimensions[c].width = 16
wb.save(OUT)
print('ok', OUT)
