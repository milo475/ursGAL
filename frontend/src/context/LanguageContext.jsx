import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { setFormatLang } from '../lib/format'

/**
 * Хэлний систем. Түлхүүр нь ихэвчлэн МОНГОЛ эх текст өөрөө —
 * en толиос орчуулгаа авна, олдохгүй бол монголоороо үлдэнэ.
 * Хоёр өөр утгатай давхардсан үгэнд 'reason.order' маягийн түлхүүр
 * ашиглаж mn толидоо мөн бүртгэнэ. {var} орлуулга дэмжинэ.
 */
const DICT = {
  mn: {
    'stock.out': 'Дууссан',
    'reason.order': 'Захиалга',
    'table.range': '{from}–{to} / нийт {total}',
    'finance.income': 'Орлого',
    'finance.expense': 'Зарлага',
    'pay.transfer': 'Шилжүүлэг',
    'pay.remaining': 'Үлдэгдэл',
    'ret.partial': 'Хэсэгчлэн буцаасан',
    'ret.full': 'Буцаасан',
    'ret.restocked': 'Үлдэгдэлд нэмсэн',
    'ret.excluded': 'Цалингаас хассан',
    'ret.left': 'Үлдсэн',
    'action.create': 'Үүсгэсэн',
    'action.update': 'Зассан',
    'action.delete': 'Устгасан',
    'action.permission': 'Эрх өөрчилсөн',
  },
  en: {
    // — Нэвтрэлт, бүрхүүл —
    'Захиалга, хүргэлтийн систем': 'Order & delivery system',
    'Имэйл': 'Email',
    'Нууц үг': 'Password',
    'Нэвтрэх': 'Log in',
    'Нэвтэрч байна…': 'Logging in…',
    'ачаалж байна…': 'loading…',
    'Самбар': 'Dashboard',
    'Нүүр': 'Home',
    'Агуулах': 'Warehouse',
    'Миний хүргэлт': 'My deliveries',
    'Менежер': 'Manager',
    'Жолооч': 'Driver',
    'Бараа': 'Products',
    'Захиалга': 'Orders',
    'Үлдэгдэл': 'Stock',
    'Хэрэглэгчид': 'Users',
    'Тохиргоо': 'Settings',
    'Гарах': 'Log out',
    'Админ': 'Admin',
    'Оператор': 'Operator',
    'Харилцагч': 'Partner',
    'Харанхуй': 'Dark',
    'Цайвар': 'Light',
    'Тема солих': 'Toggle theme',

    // — Нийтлэг —
    'Хадгалах': 'Save',
    'Бүртгэх': 'Create',
    'Болих': 'Cancel',
    'Хаах': 'Close',
    'Дахин оролдох': 'Retry',
    'Тийм': 'Yes',
    'Баталгаажуулах': 'Confirm',
    'Нийт': 'Total',
    'Бүгд': 'All',
    'Хайлт': 'Search',
    'Огноо': 'Date',
    'Нэр': 'Name',
    'Утас': 'Phone',
    'Ангилал': 'Category',
    'Үнэ': 'Price',
    'Төлөв': 'Status',
    'Статус': 'Status',
    'Дүн': 'Amount',
    'Эрх': 'Role',
    'Шалтгаан': 'Reason',
    'Хэрэглэгч': 'User',
    'Юу ч алга': 'Nothing here',
    'table.range': '{from}–{to} of {total}',

    // — Самбар —
    'Нөөцийн эрүүл мэнд': 'Stock health',
    'бараа': 'items',
    'Эрсдэлд буй дүн': 'Value at risk',
    'Эрсдэлтэй бараа': 'Items at risk',
    'Дундаж оноо': 'Median score',
    '30 хоногт нөхөх': 'Restock in 30 days',
    '/ 4 дол.хон': '/ 4 wk',
    '— 4 дол.хон': '— 4 wk',
    'Нэгтгэсэн': 'Combined',
    'Категориор': 'By category',
    'эрсдэлийн босго': 'risk threshold',
    'Хяналтын жагсаалт — хамгийн эрсдэлтэй 8': 'Watchlist — top 8 at risk',
    'Сарын борл.': 'Mo. sales',
    'Оноо': 'Score',
    '13 дол.хон': '13 wk',
    'Уналт': 'Drawdown',
    'Дуусах': 'Runway',
    'Эргэц': 'Turnover',
    '7 хон. Δ': 'WoW Δ',
    'Сүүлд нөхсөн': 'Last restock',
    'Дараагийн': 'Next',
    'хон': 'd',
    'дх': 'wk',
    'Онооны задаргаа': 'Score breakdown',
    '13 долоо хоногийн хандлага': '13-week trend',
    'Нийлүүлэгч': 'Supplier',
    'Үлдэгдэл / захиалгын түвшин': 'Stock / reorder level',
    'Сарын борлуулалт': 'Monthly sales',
    'Дараагийн нөхөлт': 'Next restock',
    'хоног': 'days',
    'Суурь': 'Base',
    'Эцсийн оноо': 'Final score',
    'Үлдэгдлийн хүрэлцээ': 'Stock adequacy',
    'Зарлагын хурд': 'Outflow rate',
    'Нөхөн дүүргэлтийн хоцролт': 'Restock delay',
    'Өгөгдөл ачаалж чадсангүй': 'Failed to load data',
    'Бараа бүртгэгдээгүй байна': 'No products registered yet',
    'Эхлээд бараагаа бүртгэж, үлдэгдэл оруулна уу':
      'Register products and add stock first',

    // — Бараа —
    '+ Шинэ бараа': '+ New product',
    'Нэр эсвэл SKU…': 'Name or SKU…',
    'Бүх ангилал': 'All categories',
    'stock.out': 'Out of stock',
    'Идэвхтэй': 'Active',
    'Идэвхгүй': 'Inactive',
    'Засах': 'Edit',
    'Идэвхгүй болгох': 'Deactivate',
    'Шинэ бараа': 'New product',
    'Ангилалгүй': 'No category',
    'Үнэ (₮)': 'Price (₮)',
    'Шинэ бараа бүртгэгдлээ': 'Product created',
    'Бараа шинэчлэгдлээ': 'Product updated',
    '«{name}» идэвхгүй боллоо': '“{name}” deactivated',
    '«{name}» барааг идэвхгүй болгох уу? Жагсаалтад харагдахгүй болно, хуучин захиалгууд хадгалагдана.':
      'Deactivate “{name}”? It will disappear from lists; past orders are preserved.',
    'Бараа олдсонгүй': 'No products found',
    'Жагсаалт ачаалж чадсангүй': 'Failed to load list',

    // — Үлдэгдэл тохируулга —
    'Одоогийн үлдэгдэл:': 'Current stock:',
    'Жишээ: агуулахын тооллого': 'e.g. inventory count',
    '«{name}» үлдэгдэл: {qty} {unit}': '“{name}” stock: {qty} {unit}',

    // — Захиалга —
    '+ Шинэ захиалга': '+ New order',
    '№, нэр, утас…': 'No., name, phone…',
    '№': 'No.',
    'Үүсгэсэн': 'Created by',
    'Захиалга олдсонгүй': 'No orders found',
    'Шинэ': 'New',
    'Баталгаажсан': 'Confirmed',
    'Бэлтгэж буй': 'Preparing',
    'Бэлэн': 'Ready',
    'Дууссан': 'Completed',
    'Цуцлагдсан': 'Cancelled',
    'Хүлээгдэж буй': 'Pending',
    'Хуваарилагдсан': 'Assigned',
    'Замд яваа': 'On the way',
    'Хүргэгдсэн': 'Delivered',
    'Амжилтгүй': 'Failed',
    'Бэлтгэж эхлэх': 'Start preparing',
    'Бэлэн болсон': 'Mark ready',
    'Дуусгах': 'Complete',
    'Цуцлах': 'Cancel',
    '← Захиалгын жагсаалт': '← Orders list',
    'Хаяг': 'Address',
    'Хүргэлтийн хаяг': 'Delivery address',
    'Тэмдэглэл': 'Note',
    'Нэгж үнэ': 'Unit price',
    'Тоо': 'Qty',
    'Захиалга цуцлах': 'Cancel order',
    'Үлдэгдэл буцаан нэмэгдэнэ. Цуцлах уу?':
      'Stock will be restored. Cancel this order?',
    'Статус шинэчлэгдлээ': 'Status updated',
    'Захиалга цуцлагдаж, үлдэгдэл буцаан нэмэгдлээ':
      'Order cancelled, stock restored',
    'Захиалга ачаалж чадсангүй': 'Failed to load order',

    // — Шинэ захиалга —
    'Шинэ захиалга': 'New order',
    'Олдсонгүй': 'Not found',
    '⚠ Үлдэгдэл: {n}': '⚠ In stock: {n}',
    'Мөр устгах': 'Remove row',
    'Захиалга үүсгэх': 'Create order',
    'Захиалга {no} үүслээ': 'Order {no} created',

    // — Шинэ захиалга: 2 алхамт wizard —
    'Хаяг, хүлээн авагч': 'Address & recipient',
    'Бараа сонгох': 'Select items',
    'Улаанбаатар': 'Ulaanbaatar',
    'Орон нутаг': 'Countryside',
    'Дүүрэг': 'District',
    'Хороо': 'Khoroo',
    'Барилга/Хороолол/Хашаа': 'Building / Complex / Fence',
    'Орц': 'Entrance',
    'Давхар': 'Floor',
    'Хаалга': 'Door',
    'Аймаг': 'Province',
    'Сум/Суурин газар': 'Soum / Settlement',
    'Ачаа явах тээвэр': 'Freight transport',
    'Жишээ: Од транс, 99112233': 'e.g. Od Trans, 99112233',
    'Хаягийн дэлгэрэнгүй': 'Address details',
    'Хүлээн авагчийн нэр': 'Recipient name',
    'Хүлээн авагчийн утас': 'Recipient phone',
    'Нэмэлт утас': 'Extra phone',
    'Нэмэлт тэмдэглэл': 'Note',
    '(заавал биш)': '(optional)',
    'Үргэлжлүүлэх': 'Continue',
    'Дүүрэг заавал': 'District is required',
    'Хороо заавал': 'Khoroo is required',
    'Барилга/Хороолол/Хашаа заавал': 'Building is required',
    'Орц заавал': 'Entrance is required',
    'Давхар заавал': 'Floor is required',
    'Хаалга заавал': 'Door is required',
    'Аймаг заавал': 'Province is required',
    'Сум/Суурин газар заавал': 'Soum is required',
    'Ачаа явах тээвэр заавал': 'Transport is required',
    'Утасны дугаар 8 оронтой тоо байна': 'Phone must be 8 digits',
    'Нэмэлт утас 8 оронтой тоо байна': 'Extra phone must be 8 digits',

    // — Хаягийн харагдац (N4) —
    'УБ': 'UB',
    'Тээвэрт гаргах': 'Send by freight',

    // — Sidebar (V3-01) —
    'Цэс хумих': 'Collapse menu',
    'Цэс дэлгэх': 'Expand menu',

    // — Permission Panel (V3-05) —
    'Эрхүүд': 'Permissions',
    '← Хэрэглэгчид': '← Users',
    'Эрхийн тохиргоо хадгалагдлаа': 'Permissions saved',
    'Default руу буцаах': 'Reset to default',
    'Админд бүх эрх үргэлж нээлттэй — өөрчлөх боломжгүй.':
      'Admins always have every permission — cannot be changed.',
    '{n} өөрчлөлт': '{n} change(s)',
    'Санхүү': 'Finance',
    'Тайлан': 'Reports',
    'Систем': 'System',

    // — Payroll (V3-07) —
    'Тооцоогүй цалин': 'Unsettled pay',
    'Тооцоонд орсон': 'In settlement',
    'Олгосон нийт': 'Total paid out',

    // — Finance + Payroll хуудсууд (V3-08) —
    'Жолоочийн цалин': 'Driver payroll',
    'Нийт орлого': 'Total income',
    'Нийт зарлага': 'Total expense',
    'Зөрүү': 'Net',
    'Сүүлийн 30 хоног': 'Last 30 days',
    '30 хоногийн орлого, зарлага': '30-day income and expense',
    // 'Орлого/Зарлага' stock-д 'In/Out' тул finance-д тусгай түлхүүр
    'finance.income': 'Income',
    'finance.expense': 'Expense',
    '+ Гүйлгээ нэмэх': '+ Add entry',
    'Шинэ орлого': 'New income',
    'Шинэ зарлага': 'New expense',
    'Өөр ангилал…': 'Other category…',
    'Ангиллын нэр': 'Category name',
    'Гүйлгээ нэмэгдлээ': 'Entry added',
    'Гүйлгээ олдсонгүй': 'No entries found',
    'Тооцоо харах': 'View payroll',
    'Борлуулалт': 'Sales',
    'Урьдчилгаа': 'Advance payment',
    'Бусад орлого': 'Other income',
    'Түрээс': 'Rent',
    'Тээвэр': 'Transport',
    'Хангамж': 'Supplies',
    'Цалин': 'Salary',
    'Бусад зарлага': 'Other expense',
    'Тооцоо хийгдээгүй': 'Awaiting settlement',
    'Тооцоо хийгдээгүй жолооч алга': 'No drivers awaiting settlement',
    'Тооцооны түүх': 'Settlement history',
    'Тооцоо хийгдээгүй байна': 'No settlements yet',
    'Тооцоо хаах': 'Close settlement',
    'Тооцоо хаагдлаа': 'Settlement closed',
    'Төлсөн болгох': 'Mark as paid',
    'Төлсөн болголоо': 'Marked as paid',
    'Төлсөн': 'Paid',
    'Хугацаа': 'Period',
    '{name} — {n} хүргэлт, {amt}. Тооцоо хаах уу?':
      '{name} — {n} deliveries, {amt}. Close this settlement?',
    '{name} — {amt}. Цалинг олгосон гэж тэмдэглэхдээ итгэлтэй байна уу?':
      '{name} — {amt}. Are you sure you want to mark this payout as paid?',

    // — Төлбөр (V4-02) —
    'Төлбөр': 'Payment',
    'Төлөөгүй': 'Unpaid',
    'Хэсэгчлэн': 'Partial',
    'Төлбөр бүртгэх': 'Record payment',
    'Төлбөр бүртгэгдлээ': 'Payment recorded',
    'Төлбөр устгах': 'Delete payment',
    'Төлбөрийн бүртгэл устлаа': 'Payment record deleted',
    'Энэ төлбөрийн бүртгэлийг устгахдаа итгэлтэй байна уу? Орлого нь хамт хасагдана.':
      'Are you sure you want to delete this payment record? Its income entry will be removed too.',
    'Хэлбэр': 'Method',
    'Устгах': 'Delete',
    'Авлага': 'Receivables',
    'Нийт авлага': 'Total receivables',
    '{n} захиалга': '{n} orders',
    'Хоног': 'Days',
    'Авлага байхгүй — бүх төлбөр цугларсан':
      'No receivables — all payments collected',

    // — Өртөг + ашиг (V4-03) —
    'Өртөг': 'Cost',
    'Өртөг (₮)': 'Cost (₮)',
    'Ашиг': 'Profit',
    'Нийт ашиг': 'Total profit',
    'Нэгжийн өртөг (₮)': 'Unit cost (₮)',
    'pay.transfer': 'Transfer',
    'pay.remaining': 'Remaining',

    // — Буцаалт (V4-04) —
    'Буцаалт': 'Returns',
    'Буцаалт бүртгэх': 'Record return',
    'Буцаалт бүртгэгдлээ': 'Return recorded',
    'Буцаах бараа сонгоно уу': 'Select items to return',
    'Үлдэгдэлд буцаан нэмэх': 'Restock returned items',
    'Төлсөн дүнгээс буцаан олгох': 'Refund from paid amount',
    'Жолоочийн цалингийн тооцооноос хасах': 'Exclude from driver payroll',
    'тооцоо хаагдсан': 'payout closed',
    'ret.partial': 'Partial return',
    'ret.full': 'Returned',
    'ret.restocked': 'Restocked',
    'ret.excluded': 'Excluded from payroll',
    'ret.left': 'Left',

    // — Хүргэлтийн тариф (V4-05) —
    'Хүргэлтийн хөлс': 'Delivery fee',

    // — Нууц үг сэргээх (V4-06) —
    'Нууц үг сэргээх': 'Reset password',
    '«{name}»-д шинэ түр нууц үг үүсгэнэ. Хуучин нууц үг нь ажиллахаа болино. Үргэлжлүүлэх үү?':
      'A new temporary password will be generated for "{name}". Their old password will stop working. Continue?',
    'Сэргээх': 'Reset',
    'Түр нууц үг': 'Temporary password',
    '«{name}»-ийн түр нууц үг. Энэ цонхыг хаасны дараа ДАХИН харагдахгүй — хуулж аваад хэрэглэгчид дамжуулна уу.':
      'Temporary password for "{name}". It will NOT be shown again after closing — copy it and hand it to the user.',
    'Хуулах': 'Copy',
    'Хуулагдлаа ✓': 'Copied ✓',
    'Хуулж чадсангүй — гараар хуулна уу': 'Copy failed — copy manually',
    'Хэрэглэгч түр нууц үгээр нэвтрээд шинэ нууц үг зохиох хүртэл систем түгжээтэй байна.':
      'The user stays locked out of the system until they log in with the temporary password and set a new one.',
    'Нууц үг мартсан?': 'Forgot password?',
    'Админд хандаж түр нууц үг авна уу. Түр нууц үгээр нэвтэрсний дараа шинэ нууц үгээ зохионо.':
      'Contact your admin for a temporary password. After logging in with it you will set a new password.',
    'Холбогдох утас': 'Contact phone',
    'Шинэ нууц үг зохиох': 'Set a new password',
    'Түр нууц үгээ сольсны дараа систем нээгдэнэ':
      'The system unlocks after you replace the temporary password',
    'Түр (хуучин) нууц үг': 'Temporary (old) password',
    'Хадгалж байна…': 'Saving…',
    'Нууц үг солих': 'Change password',
    'Замд гарлаа': 'On my way',

    // — Нэршил: Харилцагч = бараа нийлүүлэгч түнш (OPERATOR эрх) —
    'Хүлээн авагч': 'Recipient',
    'Нийт хүлээн авагч': 'Total recipients',
    'Захиалгын хүлээн авагчид': 'Order recipients',
    'Харилцагч алга — Хэрэглэгчид хуудаснаас «Харилцагч» эрхтэйгээр бүртгэнэ':
      'No partners yet — register them on the Users page with the "Partner" role',

    // — Олноор хуваарилах (V5) —
    'Жолооч хуваарилах': 'Assign driver',
    'Сонгосон {n} захиалгыг нэг жолоочид хуваарилна.':
      'Assign the {n} selected orders to one driver.',
    'Хуваарилах': 'Assign',
    'идэвхтэй': 'active',
    '{n} захиалга хуваарилагдлаа': '{n} orders assigned',
    'Хуваарилж чадсангүй: {list}': 'Could not assign: {list}',
    'DR%': 'DR%',

    'Амжилтгүй хүргэлт': 'Failed deliveries',
    'Хэрэглэгчтэй ярилцаад дахин жолооч хуваарилна':
      'Call the customer, then assign a driver again',

    // — Жолоочийн бүс (V5) —
    'Жолоочийн бүс': 'Driver zones',
    'Дүүрэг бүрт хэн явахыг эндээс тохируулна. «Дүүргээр автоматаар хуваарилах» энэ жагсаалтаар ажиллана.':
      'Set who covers each district here. "Auto by district" runs off this list.',
    'жолоочгүй': 'no driver',
    'жолооч': 'drivers',
    'Жолооч нэмэх': 'Add driver',
    'хасах': 'remove',
    'жолооч нэмэх': 'add driver',
    'Бүсгүй жолооч': 'Drivers with no zone',
    'Бүсгүй жолооч автомат хуваарилалтад орохгүй — гараар л өгнө':
      'Drivers with no zone are skipped by auto-assign — assign them by hand',

    'Цэс': 'Menu',

    'Шинэ компани үүсгэх': 'Create a new company',
    'Шинэ нийлүүлэгч компани': 'New supplier company',
    'Үүсгэх': 'Create',
    '{name} нэмэгдлээ': '{name} added',
    '{name} аль хэдийн бүртгэлтэй — сонголоо':
      '{name} already exists — selected it',

    // — Эрхийн панелын нэршил: customers.* нь нийлүүлэгч компанийнх —
    'Нийлүүлэгч компани': 'Supplier company',
    'Захиалга цуцлах': 'Cancel orders',
    'Маршрутын дараалал тавих': 'Set route order',
    'Нийлүүлэгч компани харах': 'View supplier companies',
    'Нийлүүлэгч компани засах': 'Edit supplier companies',

    'Харилцагчаар шүүх': 'Filter by partner',

    // — Нийлүүлэгчийн самбар (V5) —
    'Нийлүүлэгч': 'Supplier',
    'Танай компани бүртгэгдээгүй байна': 'Your company is not registered yet',
    'Админ таныг харилцагч компанид холбосны дараа нийлүүлэлт, тооцоо энд харагдана':
      'Once an admin links you to a partner company, your supplies and balance appear here',
    'Таны нийлүүлсэн бараа ба тооцоо': 'Goods you supplied and your balance',
    'Танд төлөх': 'We owe you',
    'Төлөгдөөгүй үлдэгдэл байна': 'There is an unpaid balance',
    'Дуусч буй таны бараа': 'Your goods running low',
    'Бүх бараа хангалттай': 'All goods are in stock',
    'Сүүлийн нийлүүлэлт': 'Recent supplies',
    'Хандах эрх байхгүй': 'No access',

    // — Нийлүүлэлт (V5) —
    'Нийлүүлэлт': 'Supplies',
    'Харилцагчаас хүлээж авсан бараа ба тооцоо':
      'Goods received from partners and their balances',
    '+ Бараа хүлээж авах': '+ Receive goods',
    'Бараа хүлээж авах': 'Receive goods',
    'Нийлүүлэлтүүд': 'Supplies',
    'Харилцагчийн тооцоо': 'Partner balances',
    'Нийлүүлэлт алга': 'No supplies yet',
    'Харилцагчаас бараа хүлээж авахад энд бүртгэгдэнэ':
      'Goods received from a partner are recorded here',
    'Харилцагч алга': 'No partners',
    'Нийт өртөг': 'Total cost',
    'Өр': 'Owed',
    'Нийт өр': 'Total owed',
    'Сүүлд': 'Last',
    'Төлбөр хийх': 'Make a payment',
    'Үлдсэн өр': 'Remaining',
    'Төлөх': 'Pay',
    'Төлбөр бүртгэгдлээ': 'Payment recorded',
    'Хүлээж авах': 'Receive',
    '{no} бүртгэгдлээ': '{no} recorded',
    'Өртөг': 'Cost',

    // — Захиалга засах (V5) —
    'Захиалга зассан': 'Order updated',
    'Бараа нэмэх': 'Add product',
    'Нэмэлт утас': 'Extra phone',
    'Хүргэлтийн хаяг': 'Delivery address',
    'Бүс': 'Region',
    'Улаанбаатар': 'Ulaanbaatar',
    'Нэмэлт хаяг': 'Address detail',
    'Захиалгад дор хаяж 1 бараа байна': 'An order needs at least 1 product',
    'Төлсөн дүн {paid} — дүн өөрчлөгдвөл төлбөрийн төлөв дагаж шинэчлэгдэнэ':
      'Paid {paid} — the payment status follows the new total',

    // — Борлуулагч (V5) —
    'Борлуулагч': 'Seller',
    'Борлуулагчийн самбар': 'Seller board',
    'Хүсэлт шалгах → захиалга болгох → хүргэлтэд гаргах':
      'Check request → convert to order → release to delivery',
    'Хүлээгдэж буй хүсэлт': 'Pending requests',
    'Өнөөдөр батласан': 'Confirmed today',
    'Жолооч хүлээж буй': 'Awaiting driver',
    'Өнөөдөр хүргэлтэд гарсан': 'Released today',
    'Шалгах хүсэлтүүд': 'Requests to check',
    'Бүгдийг харах': 'View all',
    'Жолооч хүлээж буй захиалга': 'Orders awaiting a driver',
    'Бүгд хуваарилагдсан': 'All assigned',

    // — Худалдан авалтын түүх (V5) —
    'Худалдан авалтын түүх': 'Purchase history',
    'Анхны худалдан авалт — өмнөх захиалга алга':
      'First purchase — no previous orders',
    'Бусад нэр': 'Other names',
    'цуцалсан': 'cancelled',
    'Нийт дүн': 'Total',
    'Авлага': 'Due',
    'Анх': 'First',
    'Ихэвчлэн авдаг': 'Usually buys',
    'Захиалгууд': 'Orders',

    // — Бүсээр хуваарилалт (V5) —
    'Дүүргээр автоматаар': 'Auto by district',
    'Жолоочийн харьяалах бүсээр сонгож, ачааллыг тэнцвэржүүлнэ':
      'Picks by the driver’s assigned zone and balances the load',
    '{n} захиалга бүсээр нь хуваарилагдлаа': '{n} orders assigned by zone',
    'Үлдсэн': 'Skipped',
    'бүсэд нь харьяалагдах': 'covered by their zone',
    'Бусад жолооч — бүс нь таарахгүй': 'Other drivers — zone does not match',
    'бүсгүй': 'no zone',
    'Энэ жолоочийн харьяалах бүсэд {d} ороогүй байна':
      '{d} is not in this driver’s assigned zones',

    'Хуваарилаагүй {n} захиалга': '{n} unassigned orders',

    // — Нярав (V5) —
    'Нярав': 'Keeper',
    'Нярав хуваарилах': 'Assign keeper',
    'Сонгосон {n} захиалга тухайн няравын бэлтгэлийн самбарт орно.':
      'The {n} selected orders go to that keeper’s prep board.',
    'Идэвхтэй нярав алга — User хэсэгт нэмнэ үү':
      'No active keeper — add one on the User page',
    '{n} захиалга няравт өглөө': '{n} orders handed to the keeper',
    'Бэлтгэл, жолоочид хүлээлгэн өгөх, хуудасны түүх':
      'Preparation, driver handover and sheet history',
    'Бэлтгэл': 'Preparation',
    'Хүлээлгэсэн хуудсууд': 'Handover sheets',
    'Надад хуваарилаагүйг ч харах': 'Show orders not assigned to me',
    'Бэлтгэх захиалга алга': 'Nothing to prepare',
    'Менежер захиалга хуваарилахад энд гарч ирнэ':
      'Orders appear here once a manager assigns them',
    'захиалга': 'orders',
    'бэлэн': 'ready',
    'Бэлэн': 'Ready',
    'Нийт түүх бараа': 'Total goods to pick',
    'Хүлээлгэн өгөх': 'Hand over',
    'Баталгаажуулж хэвлэх': 'Confirm and print',
    'Тэмдэглэл (заавал биш)': 'Note (optional)',
    '{no} хуудас үүслээ': 'Sheet {no} created',
    'Хуудас алга': 'No sheets yet',
    'Хэвлэх цонхыг зөвшөөрнө үү': 'Please allow the print window',
    'Бараа хүлээлгэн өгсөн хуудас': 'Goods handover sheet',
    'Нийт хүлээлгэн өгсөн бараа': 'Total goods handed over',
    'Захиалга тус бүр': 'Per order',
    'Хүлээлгэн өгсөн (нярав)': 'Handed over by (keeper)',
    'Хүлээн авсан (жолооч)': 'Received by (driver)',
    'Баталгаажуулахад хуудас хэвлэгдэнэ — гарын үсгээ цаасан дээр нь зурна':
      'Confirming prints the sheet — sign it on paper',

    'Зураг солих': 'Change image',
    'Зураг хадгалагдлаа': 'Image saved',

    // — Захиалгын хүсэлт (V5) —
    'Хүсэлтүүд': 'Requests',
    'Хүсэлт алга': 'No requests',
    'Захиалга болгох': 'Convert to order',
    'Захиалга болсон': 'Converted',
    'Хаасан': 'Closed',
    'Хүсэлт хаах': 'Close request',
    'Энэ хүсэлтийг хаах уу? Захиалга үүсэхгүй.':
      'Close this request? No order will be created.',
    'Хүсэлт хаагдлаа': 'Request closed',
    'Гүйлгээний баримт': 'Payment receipt',
    'Төлсөн гэсэн': 'Marked paid',
    'Захиалгын линк хуулах': 'Copy order link',
    'Линк хуулагдлаа': 'Link copied',

    // — Компани / бүс (V5) —
    'Харилцагч компани': 'Partner company',
    'Компаниуд': 'Companies',
    'Компани': 'Company',
    'Оператор': 'Operators',
    'Компани алга': 'No companies',
    'Сонгоогүй': 'Not selected',
    'Бүх харилцагч': 'All partners',
    'Харьяалах бүс': 'Assigned zones',
    'Эхлээд дүүргээ сонгоно уу': 'Select a district first',

    // — Жолооч (V5) —
    'Ажлын төрөл': 'Employment type',
    'Үндсэн': 'Full-time',
    'Цагийн': 'Hourly',

    // — Суваг (V5) —
    'Суваг': 'Channel',
    'Захиалга ирсэн суваг': 'Order channel',
    'Бусад': 'Other',
    'захиалга': 'orders',

    // — Харилцагчид —

    // — Барааны каталог (сагс) —
    'Бараа шүүх — нэр, SKU, barcode…': 'Filter products — name, SKU, barcode…',
    'Ангилалгүй': 'Uncategorized',
    'Сагслах': 'Add to cart',
    'Сагсанд': 'In cart',
    'Сагс хоосон': 'Cart is empty',
    'Дээрх каталогоос бараа сонгож сагслана уу': 'Pick products from the catalog above',
    'Бараа ачаалж чадсангүй': 'Could not load products',

    // — Алдааны лог (V4-14) —
    'Системийн алдаа': 'System errors',
    '{n} алдаа': '{n} errors',
    'Энэ өдөр серверийн алдаа бүртгэгдээгүй ✅': 'No server errors recorded on this day ✅',

    // — CSV импорт + barcode (V4-12) —
    'Импорт': 'Import',
    'Бараа CSV импорт': 'Product CSV import',
    'SKU байвал шинэчилж, байхгүй бол шинээр үүсгэнэ. Эхний үлдэгдэл нь агуулахын INITIAL хөдөлгөөнөөр бүртгэгдэнэ.':
      'Existing SKUs are updated, new ones are created. Initial stock is recorded as an INITIAL stock movement.',
    'Загвар татах (CSV)': 'Download template (CSV)',
    'CSV файл': 'CSV file',
    'Шинээр үүссэн': 'Created',
    'Шинэчилсэн': 'Updated',
    'Алдаатай мөр': 'Rows with errors',
    'Мөр': 'Row',
    'Импортлох': 'Import',
    'Barcode скан': 'Scan barcode',
    'Barcode-ыг камерт ойртуулна уу': 'Point the camera at the barcode',

    // — Бэлтгэх хуудас (V4-11) —
    'Бэлтгэх хуудас': 'Picking list',
    'Нэгтгэсэн бараа (агуулахаас түүх)': 'Aggregated items (pick from warehouse)',
    'Захиалга тус бүр (баглах)': 'Per order (packing)',
    'Бэлтгэж буй болгох': 'Mark as preparing',
    'Сонгосон {n} захиалгыг «Бэлтгэж буй» болгох уу?':
      'Mark the {n} selected orders as "Preparing"?',
    '{n} захиалга Бэлтгэж буй боллоо': '{n} orders marked as preparing',
    'Шилжүүлж чадсангүй: {list}': 'Could not update: {list}',
    'Popup хориглогдсон — зөвшөөрнө үү': 'Popup blocked — please allow popups',
    'сонгох': 'select',

    // — PWA + offline (V4-10) —
    'Офлайн': 'Offline',
    'Офлайн — дараа илгээгдэнэ': 'Offline — will be sent later',
    'Илгээгдээгүй баталгаажуулалт: {n} — online болмогц автоматаар илгээгдэнэ':
      'Unsent confirmations: {n} — they will be sent automatically once online',
    '{n} баталгаажуулалт илгээгдлээ': '{n} confirmation(s) sent',

    // — Нэвтрэлтийн хамгаалалт (V4-07) —
    'Сүүлд нэвтэрсэн': 'Last login',
    'Түгжээтэй': 'Locked',
    'Түгжээ тайлах': 'Unlock',
    '«{name}»-ийн түгжээ тайлагдлаа': '"{name}" has been unlocked',

    // — Customer portal (V3-14) —
    'Нууц үг давтах': 'Repeat password',
    'Нууц үг таарахгүй байна': 'Passwords do not match',
    'Профайл': 'Profile',
    'Захиалга алга': 'No orders yet',
    'Шинэ нууц үг': 'New password',
    'Хэвлэх': 'Print',

    // — Аналитик, Тайлан, Харилцагчид, Тохиргоо (V3-17) —
    'Аналитик': 'Analytics',
    '{n} хоног': '{n} days',
    'Шүүх': 'Filter',
    'Захиалгын тоо': 'Order count',
    'Нийт дүн': 'Total amount',
    'TOP бараа': 'Top products',
    'Давтан': 'Repeat',
    '1 захиалгатай': '1 order',
    '2+ захиалгатай': '2+ orders',
    'захиалга': 'orders',
    'Жолоочдын харьцуулалт': 'Driver comparison',
    'Хүргэсэн': 'Delivered',
    'Бодогдох цалин': 'Accrued pay',
    'Жолооч алга': 'No drivers',
    'Жолооч нар': 'Drivers',
    'Хүргэлтийн тайлан': 'Delivery report',
    'Агуулахын тайлан': 'Inventory report',
    'Санхүүгийн тайлан': 'Finance report',
    'Захиалга, хаяг, жолооч, хүргэсэн огноо':
      'Orders, addresses, drivers, delivery dates',
    'Үлдэгдлийн бүх хөдөлгөөн': 'All stock movements',
    'Орлого, зарлагын гүйлгээнүүд': 'Income and expense entries',
    'Интервал': 'Range',
    'Сүүлийн {n} хоног': 'Last {n} days',
    'CSV татах': 'Download CSV',
    'Тайлан татагдлаа': 'Report downloaded',
    'CSV файлууд Excel-д кирилл үсгээрээ зөв нээгдэнэ (UTF-8 BOM)':
      'CSV files open in Excel with Cyrillic intact (UTF-8 BOM)',
    'Утасны захиалгаас': 'From phone orders',
    'Нэр(үүд)': 'Name(s)',
    'Сүүлийн захиалга': 'Last order',
    'Идэвхгүй болгох': 'Deactivate',
    'Системийн тохиргоо': 'System settings',
    'Компанийн нэр': 'Company name',
    'Компанийн утас': 'Company phone',
    'Тохиргоо хадгалагдлаа': 'Settings saved',
    'Төлөв': 'Status',
    'Идэвхтэй хүргэлт': 'Active deliveries',
    'Өнөөдөр хүргэсэн': 'Delivered today',
    'Нийт хүргэсэн': 'Total delivered',
    'Тээврийн хэрэгсэл': 'Vehicle',
    'Идэвхгүй': 'Inactive',
    'Бүртгэл засах': 'Edit accounts',
    'Тайлбар': 'Note',
    'Системээс гарах': 'Sign out',
    'Та системээс гарахдаа итгэлтэй байна уу?':
      'Are you sure you want to sign out?',
    'Ж: Гэрт нь байгаагүй — доод талын дэлгүүрт үлдээсэн':
      'e.g. Recipient not home — left at the store downstairs',
    'Хүргэлт баталгаажуулах': 'Confirm delivery',
    'Амжилтгүй тэмдэглэх': 'Mark as failed',
    'Та энэ хүргэлтийг амжилттай гэж баталгаажуулахдаа итгэлтэй байна уу?':
      'Are you sure you want to confirm this delivery as successful?',
    'Та энэ хүргэлтийг амжилтгүй гэж тэмдэглэхдээ итгэлтэй байна уу?':
      'Are you sure you want to mark this delivery as failed?',

    // — Мэдэгдэл + Үйлдлийн түүх (V3-10) —
    'Мэдэгдэл': 'Notifications',
    'Мэдэгдэл алга': 'No notifications',
    'Бүгдийг харах': 'View all',
    'Бүгдийг уншсан болгох': 'Mark all as read',
    'Үйлдлийн түүх': 'Activity log',
    'Үйлдэл': 'Action',
    'Объект': 'Entity',
    'Дэлгэрэнгүй': 'Details',
    'Эхлэх': 'From',
    'Дуусах': 'To',
    'Бичилт олдсонгүй': 'No records found',
    'action.create': 'Created',
    'action.update': 'Updated',
    'action.delete': 'Deleted',
    'action.permission': 'Permission change',
    'Эрхийн тохиргоо': 'Permissions',

    // — Хүргэлтийн удирдлага + маршрут (V3-12) —
    'Хүргэлтийн удирдлага': 'Delivery operations',
    'Өнөөдөр дууссан': 'Delivered today',
    'Жолоочид': 'Drivers',
    'Жолоочгүй': 'Unassigned',
    'Маршрутын дараалал': 'Route order',
    'Дараалал хадгалах': 'Save order',
    'Дараалал хадгалагдлаа': 'Route order saved',
    'Идэвхтэй хүргэлт алга': 'No active deliveries',
    'Замын зураг': 'Map',
    'Миний маршрут': 'My route',

    // — Үлдэгдлийн хөдөлгөөн —
    'Үлдэгдлийн хөдөлгөөн': 'Stock movements',
    'Бүх бараа': 'All products',
    'Өөрчлөлт': 'Change',
    'Холбоос': 'Reference',
    'Захиалга харах': 'View order',
    'Захиалгын төлбөр': 'Order payment',
    'Дараалал хадгалах эрх байхгүй': 'No permission to save the order',
    'reason.order': 'Order',
    'Цуцлалт': 'Cancellation',
    'Эхний орлого': 'Initial stock',
    'Гар тохируулга': 'Manual',
    'Хөдөлгөөн бүртгэгдээгүй': 'No movements recorded',
    'Түүх ачаалж чадсангүй': 'Failed to load history',

    // — Хэрэглэгчид —
    '+ Шинэ хэрэглэгч': '+ New user',
    'Бүртгэсэн': 'Created',
    'Бүтэн нэр': 'Full name',
    'Хамгийн багадаа 6 тэмдэгт': 'At least 6 characters',
    'Шинэ хэрэглэгч': 'New user',
    '«{name}» бүртгэгдлээ': '“{name}” created',
    '«{name}» идэвхжлээ': '“{name}” activated',
    'Хэрэглэгч идэвхгүй болгох': 'Deactivate user',
    '«{name}» цаашид нэвтэрч чадахгүй болно. Идэвхгүй болгох уу?':
      '“{name}” will no longer be able to log in. Deactivate?',
    'Өөрийгөө идэвхгүй болгох боломжгүй': 'You cannot deactivate yourself',
    'Хэрэглэгч алга': 'No users',

    // — Эрхийн самбарууд —
    'Удирдлагын самбар': 'Admin overview',
    'Нийт хүргэлт': 'Total deliveries',
    'Нийт жолооч': 'Total drivers',
    'Хүргэлтэд гарсан': 'Out for delivery',
    'Амжилттай хүргэсэн': 'Delivered',
    '7 хоногийн гүйцэтгэл': '7-day performance',
    'Үүсгэсэн захиалга': 'Orders created',
    'Хүргэсэн': 'Delivered',
    'Шилдэг жолооч TOP-3': 'Top 3 drivers',
    'хуваарилагдсан': 'assigned',
    'хүргэсэн': 'delivered',


    'Менежерийн самбар': 'Manager overview',
    'Орлого / зарлага (7 хоног)': 'Stock in / out (7 days)',
    'Орлого': 'In',
    'Зарлага': 'Out',
    'Хуваарилалт хүлээж буй': 'Awaiting assignment',
    'Жолоочдын ачаалал': 'Driver load',
    'идэвхтэй хүргэлт': 'active',
    'Чөлөөтэй': 'Available',
    'Завгүй': 'Busy',
    'Жолоочийн самбар': 'Driver overview',
    'Өнөөдрийн хүргэлт': "Today's deliveries",
    'Нийт хүргэсэн': 'Total delivered',
    'Хүргэлтээ эхлэх': 'Start deliveries',
    '7 хоног': '7 days',

    'Лимит': 'Limit',
    'Бага үлдэгдэлтэй': 'Low stock',
    'Бага үлдэгдлийн лимит': 'Low stock limit',
    'Орлого/Зарлага': 'Stock in/out',
    'Төрөл': 'Type',
    'Залруулга': 'Correction',
    'Тоо ширхэг': 'Quantity',

    'Хүргэлт': 'Delivery',
    'Хүргэлтийн мэдээлэл': 'Delivery info',
    'Жолооч хуваарилах': 'Assign driver',
    'Хуваарилах': 'Assign',
    'Жолооч хуваарилагдлаа': 'Driver assigned',
    'Хуваарилсан': 'Assigned at',
    'Хүргэсэн огноо': 'Delivered at',
    'Баталгаажуулах зураг': 'Proof photo',
    '(завгүй)': '(busy)',

    'Одоогоор хуваарилагдсан хүргэлт алга': 'No deliveries assigned right now',
    'Амжилттай': 'Successful',
    'Илгээх': 'Submit',
    'Шалтгаан бичнэ үү': 'Enter the reason',
    'Хүргэлт баталгаажлаа': 'Delivery confirmed',
    'Амжилтгүй гэж тэмдэглэгдлээ': 'Marked as failed',

    'Хөлс': 'Fee',
    'Хүргэлтийн хөлс (₮)': 'Fee per delivery (₮)',
    'Тээврийн хэрэгсэл': 'Vehicle',
    'Хэрэглэгч шинэчлэгдлээ': 'User updated',

    // — Тохиргоо —
    'Хэл': 'Language',
    'Тема': 'Theme',
    'Интерфэйсийн хэлийг сонгоно. Серверийн алдааны мессежүүд одоогоор зөвхөн монголоор ирдэг.':
      'Choose the interface language. Server error messages are currently in Mongolian only.',
  },
}

const LanguageContext = createContext(null)

function applyVars(str, vars) {
  if (!vars) return str
  let out = str
  for (const [k, v] of Object.entries(vars)) {
    out = out.replaceAll(`{${k}}`, String(v))
  }
  return out
}

export function LanguageProvider({ children }) {
  const [lang, setLang] = useState(() => {
    try {
      return localStorage.getItem('lang') ?? 'mn'
    } catch {
      return 'mn'
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem('lang', lang)
    } catch {
      /* хадгалагдахгүй бол session дотроо л үйлчилнэ */
    }
    setFormatLang(lang)
    document.documentElement.lang = lang
  }, [lang])

  const t = useCallback(
    (key, vars) => {
      const s = DICT[lang]?.[key] ?? DICT.mn[key] ?? key
      return applyVars(s, vars)
    },
    [lang],
  )

  return (
    <LanguageContext.Provider value={{ lang, setLang, t }}>
      {children}
    </LanguageContext.Provider>
  )
}

export function useLang() {
  const ctx = useContext(LanguageContext)
  if (!ctx) throw new Error('useLang-ыг LanguageProvider дотор л хэрэглэнэ')
  return ctx
}
