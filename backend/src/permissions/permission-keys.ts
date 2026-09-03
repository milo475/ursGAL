import { Role } from '../generated/prisma/client';

/**
 * Бүх permission түлхүүр — системд НЭГ Л ГАЗАР энд тодорхойлогдоно.
 * Effective permission = UserPermission override байвал түүнийх,
 * үгүй бол ROLE_DEFAULTS.
 */
export const PERM = {
  // Захиалга
  ORDERS_VIEW: 'orders.view',
  ORDERS_CREATE: 'orders.create',
  ORDERS_ASSIGN_DRIVER: 'orders.assign_driver',
  ORDERS_CHANGE_STATUS: 'orders.change_status',
  ORDERS_EDIT: 'orders.edit',
  /**
   * Захиалга ЦУЦЛАХ. orders.change_status-аас САЛГАВ (V5): цуцлах нь
   * үлдэгдэл буцаах, мөнгө буцаах, үйлчлүүлэгчтэй ярих арилжааны
   * шийдвэр — бэлтгэл хийдэг няравын ажил биш. Нярав төлөв ахиулсаар
   * (PREPARING→READY) байх боловч цуцлахгүй.
   */
  ORDERS_CANCEL: 'orders.cancel',
  /**
   * Захиалгын төлбөр бүртгэх (V5) — least-privilege түлхүүр.
   * Өмнө нь борлуулагчид өргөн finance.create_income олгогдож байсан
   * нь захиалгатай холбоогүй ДУРЫН орлогын бичилт үүсгэх эрхийг
   * давхар өгдөг байв. Энэ түлхүүр зөвхөн захиалга дээрх төлбөрийн
   * бүртгэл (нэмэх/алдаатайг устгах)-д үйлчилнэ.
   */
  ORDERS_RECORD_PAYMENT: 'orders.record_payment',
  ORDERS_REFUND: 'orders.refund',
  ORDERS_ASSIGN_WAREHOUSE: 'orders.assign_warehouse',
  WAREHOUSE_HANDOVER: 'warehouse.handover',
  SUPPLIES_VIEW: 'supplies.view',
  /**
   * Нийлүүлэлт хүлээж авах. Урсгалын заавал алхам болох НИЙЛҮҮЛЭГЧ
   * КОМПАНИЙГ ХУРДАН ҮҮСГЭХ (POST /companies/quick) энэ түлхүүрт
   * багтана — эс тэгвэл эрхтэй хүн компанигүйн улмаас гацна.
   * Компани ЗАСАХ/УСТГАХ нь customers.edit-д хэвээр.
   */
  SUPPLIES_CREATE: 'supplies.create',
  SUPPLIES_PAY: 'supplies.pay',
  // Харилцагч
  /**
   * ⚠ Түлхүүрийн нэр нь ТҮҮХЭН шалтгаанаар `customers.*` боловч
   * бодитоор НИЙЛҮҮЛЭГЧ КОМПАНИЙГ (Company модель) хамгаална:
   * /companies жагсаалт, /customers/partners, /customers/history,
   * /companies засварлалт. Энэ системд Company-г зөвхөн нийлүүлэгчид
   * ашигладаг (User.companyId, Product.companyId, Supply.companyId);
   * захиалгын хүлээн авагч нь тусдаа модель БИШ, Order дээрх талбарууд.
   *
   * Түлхүүрийг ӨӨРЧЛӨХГҮЙ — UserPermission хүснэгтэд override нь
   * түлхүүрийн мөрөөр хадгалагддаг тул нэр солиход хуучин override-ууд
   * тасарна. Зөвхөн харагдах текстийг (PERM_LABELS) зассан.
   */
  CUSTOMERS_VIEW: 'customers.view',
  CUSTOMERS_EDIT: 'customers.edit',
  // Жолооч
  DRIVERS_VIEW: 'drivers.view',
  /**
   * ⚠ Нэр нь төөрөгдүүлдэг: жолоочийг ЗАХИАЛГАД томилох нь
   * orders.assign_driver. Энэ түлхүүр зөвхөн ЖОЛООЧИЙН МАРШРУТЫН
   * ДАРААЛЛЫГ (PATCH /deliveries/route-order) хамгаална. Түлхүүрийг
   * солихгүй (override-ууд түлхүүрийн мөрөөр хадгалагддаг) — зөвхөн
   * харагдах текстийг зассан.
   */
  DRIVERS_ASSIGN: 'drivers.assign',
  DRIVERS_ZONES: 'drivers.zones',
  // Агуулах
  INVENTORY_VIEW: 'inventory.view',
  INVENTORY_ADJUSTMENT: 'inventory.adjustment',
  // Санхүү
  FINANCE_VIEW_INCOME: 'finance.view_income',
  FINANCE_CREATE_INCOME: 'finance.create_income',
  FINANCE_VIEW_EXPENSE: 'finance.view_expense',
  FINANCE_CREATE_EXPENSE: 'finance.create_expense',
  FINANCE_DRIVER_PAYROLL: 'finance.driver_payroll',
  FINANCE_VIEW_RECEIVABLES: 'finance.view_receivables',
  // Тайлан
  REPORTS_DELIVERY: 'reports.delivery',
  REPORTS_INVENTORY: 'reports.inventory',
  REPORTS_FINANCE: 'reports.finance',
  // Систем
  USERS_MANAGE: 'users.manage',
  PERMISSIONS_MANAGE: 'permissions.manage',
  SETTINGS_EDIT: 'settings.edit',
  ACTIVITY_LOG_VIEW: 'activity_log.view',
  ANALYTICS_VIEW: 'analytics.view',
} as const;

export type PermKey = (typeof PERM)[keyof typeof PERM];

/** Бүх түлхүүрийн жагсаалт (permissions.manage UI-д хэрэглэнэ) */
export const ALL_PERMISSIONS: PermKey[] = Object.values(PERM);

/** Түлхүүр бүрийн монгол нэр — Permission Panel-д харагдана */
export const PERM_LABELS: Record<PermKey, string> = {
  [PERM.ORDERS_VIEW]: 'Захиалга харах',
  [PERM.ORDERS_CREATE]: 'Захиалга үүсгэх',
  [PERM.ORDERS_ASSIGN_DRIVER]: 'Жолооч хуваарилах',
  [PERM.ORDERS_CHANGE_STATUS]: 'Захиалгын статус солих',
  [PERM.ORDERS_EDIT]: 'Захиалга засах (хаяг, бараа)',
  [PERM.ORDERS_CANCEL]: 'Захиалга цуцлах',
  [PERM.ORDERS_RECORD_PAYMENT]: 'Захиалгын төлбөр бүртгэх',
  [PERM.ORDERS_REFUND]: 'Буцаалт бүртгэх',
  [PERM.ORDERS_ASSIGN_WAREHOUSE]: 'Нярав хуваарилах',
  [PERM.WAREHOUSE_HANDOVER]: 'Жолоочид хүлээлгэн өгөх',
  [PERM.SUPPLIES_VIEW]: 'Нийлүүлэлт харах',
  [PERM.SUPPLIES_CREATE]: 'Нийлүүлэлт хүлээж авах',
  [PERM.SUPPLIES_PAY]: 'Харилцагчид төлбөр хийх',
  // ⚠ Энэ түлхүүр ХОЁР зүйлийг нээдэг: нийлүүлэгч компанийн жагсаалт
  // БА худалдан авагчийн утас/худалдан авалтын түүх (/customers/history,
  // /customers/by-phone, /reorders). Нэрийг нь «Нийлүүлэгч компани»
  // гэж бичвэл админ зөвхөн нийлүүлэгч гэж ойлгоод үйлчлүүлэгчийн
  // мэдээллийг санамсаргүй нээж өгнө.
  [PERM.CUSTOMERS_VIEW]: 'Нийлүүлэгч ба худалдан авагч харах',
  [PERM.CUSTOMERS_EDIT]: 'Нийлүүлэгч компани засах',
  [PERM.DRIVERS_VIEW]: 'Жолооч харах',
  [PERM.DRIVERS_ASSIGN]: 'Маршрутын дараалал тавих',
  [PERM.DRIVERS_ZONES]: 'Жолоочийн бүс тохируулах',
  [PERM.INVENTORY_VIEW]: 'Агуулах харах',
  [PERM.INVENTORY_ADJUSTMENT]: 'Тохируулга хийх',
  [PERM.FINANCE_VIEW_INCOME]: 'Орлогын гүйлгээ харах',
  [PERM.FINANCE_CREATE_INCOME]: 'Орлогын гүйлгээ бүртгэх',
  [PERM.FINANCE_VIEW_EXPENSE]: 'Зарлагын гүйлгээ харах',
  [PERM.FINANCE_CREATE_EXPENSE]: 'Зарлагын гүйлгээ бүртгэх',
  [PERM.FINANCE_DRIVER_PAYROLL]: 'Жолоочийн цалин бодох',
  [PERM.FINANCE_VIEW_RECEIVABLES]: 'Авлага харах',
  [PERM.REPORTS_DELIVERY]: 'Хүргэлтийн тайлан',
  [PERM.REPORTS_INVENTORY]: 'Агуулахын тайлан',
  [PERM.REPORTS_FINANCE]: 'Санхүүгийн тайлан',
  [PERM.USERS_MANAGE]: 'Хэрэглэгч удирдах',
  [PERM.PERMISSIONS_MANAGE]: 'Эрхийн тохиргоо удирдах',
  [PERM.SETTINGS_EDIT]: 'Тохиргоо засах',
  [PERM.ACTIVITY_LOG_VIEW]: 'Үйлдлийн түүх харах',
  [PERM.ANALYTICS_VIEW]: 'Аналитик харах',
};

/** Panel-ын бүлэглэлт — дараалал нь UI-ийн дараалал */
export const PERM_GROUPS: { group: string; keys: PermKey[] }[] = [
  {
    group: 'ORDERS',
    keys: [
      PERM.ORDERS_VIEW,
      PERM.ORDERS_CREATE,
      PERM.ORDERS_ASSIGN_DRIVER,
      PERM.ORDERS_CHANGE_STATUS,
      PERM.ORDERS_EDIT,
      PERM.ORDERS_CANCEL,
      PERM.ORDERS_RECORD_PAYMENT,
      PERM.ORDERS_REFUND,
      PERM.ORDERS_ASSIGN_WAREHOUSE,
      PERM.WAREHOUSE_HANDOVER,
    ],
  },
  {
    // Бүлгийн түлхүүр 'CUSTOMERS' хэвээр (API гэрээ) — frontend-ийн
    // GROUP_LABELS «Нийлүүлэгч компани» гэж харуулна
    group: 'CUSTOMERS',
    keys: [PERM.CUSTOMERS_VIEW, PERM.CUSTOMERS_EDIT],
  },
  {
    group: 'DRIVERS',
    keys: [PERM.DRIVERS_VIEW, PERM.DRIVERS_ASSIGN, PERM.DRIVERS_ZONES],
  },
  {
    group: 'SUPPLIES',
    keys: [PERM.SUPPLIES_VIEW, PERM.SUPPLIES_CREATE, PERM.SUPPLIES_PAY],
  },
  {
    group: 'INVENTORY',
    keys: [PERM.INVENTORY_VIEW, PERM.INVENTORY_ADJUSTMENT],
  },
  {
    group: 'FINANCE',
    keys: [
      PERM.FINANCE_VIEW_INCOME,
      PERM.FINANCE_CREATE_INCOME,
      PERM.FINANCE_VIEW_EXPENSE,
      PERM.FINANCE_CREATE_EXPENSE,
      PERM.FINANCE_DRIVER_PAYROLL,
      PERM.FINANCE_VIEW_RECEIVABLES,
    ],
  },
  {
    group: 'REPORTS',
    keys: [PERM.REPORTS_DELIVERY, PERM.REPORTS_INVENTORY, PERM.REPORTS_FINANCE],
  },
  {
    group: 'SYSTEM',
    keys: [
      PERM.USERS_MANAGE,
      PERM.PERMISSIONS_MANAGE,
      PERM.SETTINGS_EDIT,
      PERM.ACTIVITY_LOG_VIEW,
      PERM.ANALYTICS_VIEW,
    ],
  },
];

/**
 * Эрх тус бүрийн default матриц — v2-ын зан төлөвтэй ЯГ ижил.
 *
 * - ADMIN: бүгд. Override-аар ХАСАГДАХГҮЙ (permission service үргэлж
 *   бүгдийг ✅ буцаана) — энэ дүрэм PermissionsService-д хатуу шалгагдана.
 * - OPERATOR-ийн orders.change_status "зөвхөн өөрийн шивсэн захиалга"
 *   гэсэн нарийвчлал permission биш — OrdersService доторх ownership
 *   шалгалт хэвээр хариуцна.
 * - DRIVER: юу ч биш — /deliveries/* endpoint-ууд permission биш
 *   @Roles(DRIVER)-оор хэвээр хамгаалагдана.
 */
export const ROLE_DEFAULTS: Record<Role, PermKey[]> = {
  [Role.ADMIN]: ALL_PERMISSIONS,
  [Role.MANAGER]: [
    PERM.ORDERS_VIEW,
    PERM.ORDERS_CHANGE_STATUS,
    PERM.ORDERS_ASSIGN_DRIVER,
    PERM.ORDERS_EDIT, // V5: хаяг/бараа засах
    PERM.ORDERS_CANCEL, // V5: цуцлалт нь арилжааны шийдвэр
    PERM.ORDERS_REFUND, // V4: буцаалт ADMIN+MANAGER
    PERM.ORDERS_ASSIGN_WAREHOUSE, // V5: няравт хуваарилах
    PERM.INVENTORY_VIEW,
    PERM.INVENTORY_ADJUSTMENT,
    PERM.SUPPLIES_VIEW,
    PERM.SUPPLIES_CREATE,
    PERM.SUPPLIES_PAY,
    // Нярав ажилдаа ирээгүй өдөр хүргэлт зогсохгүйн тулд (V5) —
    // урвуу тохиолдол нь (нярав жолооч оноох) аль хэдийн нээгдсэн
    PERM.WAREHOUSE_HANDOVER,
    PERM.DRIVERS_VIEW,
    PERM.DRIVERS_ASSIGN,
    PERM.DRIVERS_ZONES,
    PERM.FINANCE_VIEW_INCOME,
    PERM.FINANCE_CREATE_INCOME,
    PERM.FINANCE_VIEW_EXPENSE,
    PERM.FINANCE_CREATE_EXPENSE,
    PERM.FINANCE_DRIVER_PAYROLL,
    PERM.FINANCE_VIEW_RECEIVABLES, // V4: авлага ADMIN+MANAGER-т
    PERM.REPORTS_DELIVERY,
    PERM.REPORTS_INVENTORY,
    PERM.ANALYTICS_VIEW, // V3-16: аналитик ADMIN+MANAGER-т
    PERM.CUSTOMERS_VIEW, // V3-17: харилцагчийн жагсаалт ADMIN+MANAGER-т
  ],
  /**
   * Харилцагч = ӨӨР КОМПАНИЙН нийлүүлэгч түнш (V5).
   *
   * Анх «захиалга шивдэг ажилтан» гэсэн утгатай байсныг нийлүүлэгч
   * болгож нэрлэхдээ захиалгын эрхийг нь хэвээр үлдээсэн тул гаднын
   * хүн БҮХ үйлчлүүлэгчийн нэр, утас, хаяг, төлбөрийг хардаг байв.
   * Одоо зөвхөн ӨӨРИЙН компанийн нийлүүлэлт, тооцоог л харна
   * (SuppliesService.scopeFor компаниар нь шүүнэ) — дотоод мэдээлэлд
   * хүрэхгүй.
   */
  [Role.OPERATOR]: [PERM.SUPPLIES_VIEW],
  [Role.DRIVER]: [],
  /**
   * Нярав (V5): агуулахын орлого/зарлага, бэлтгэл, жолоочид хүлээлгэн
   * өгөх. Захиалгыг харах, статусыг нь ахиулах эрхтэй ч жолооч
   * хуваарилах, санхүү, эрхийн тохиргоонд хүрэхгүй.
   */
  [Role.WAREHOUSE]: [
    PERM.ORDERS_VIEW,
    PERM.ORDERS_CHANGE_STATUS,
    // Менежер жолооч оноогоогүй бол бэлтгэл зогсдог — няравт өөрт нь
    // оноох эрх өгнө (самбарын «Жолооч хуваарилаагүй» бүлэг)
    PERM.ORDERS_ASSIGN_DRIVER,
    PERM.INVENTORY_VIEW,
    PERM.INVENTORY_ADJUSTMENT,
    // Барааг агуулахад хүлээж авдаг нь нярав
    PERM.SUPPLIES_VIEW,
    PERM.SUPPLIES_CREATE,
    PERM.WAREHOUSE_HANDOVER,
    PERM.DRIVERS_VIEW,
    // Аль жолооч аль дүүрэгт явахыг өдөр бүр мэддэг нь нярав
    PERM.DRIVERS_ZONES,
    // Хэрэглэгчийн худалдан авалтын түүх — нярав тооцоо/төлөвлөлт хийхэд
    PERM.CUSTOMERS_VIEW,
  ],
  /**
   * Борлуулагч (V5): линкээр ирсэн хүсэлт ЭНД ирнэ. Хэрэглэгчийн
   * мэдээллийг шалгаж, батлаад захиалга болгоно; жолооч болон нярав
   * хуваарилж хүргэлтэд гаргана. Санхүү, эрх, тайланд хүрэхгүй.
   */
  [Role.SELLER]: [
    PERM.ORDERS_VIEW,
    PERM.ORDERS_CREATE,
    PERM.ORDERS_CHANGE_STATUS,
    // Хэрэглэгч хаягаа буруу хэлэх/бараагаа солих нь DM-д байнга гардаг
    PERM.ORDERS_EDIT,
    // Үйлчлүүлэгчтэй ярьдаг нь борлуулагч тул цуцлалт нь түүний ажил
    PERM.ORDERS_CANCEL,
    PERM.ORDERS_ASSIGN_DRIVER,
    PERM.ORDERS_ASSIGN_WAREHOUSE,
    // Гүйлгээний баримтыг ШАЛГАДАГ нь борлуулагч — дараа орсон
    // мөнгийг бүртгэхийн тулд менежер рүү явах шаардлагагүй
    /**
     * V5: finance.create_income-ийг orders.record_payment-ээр СОЛИВ.
     * Өргөн түлхүүр нь /finance/entries дээр дурын орлогын бичилт
     * үүсгэх эрхийг давхар өгдөг байсан — борлуулагчид хэрэггүй.
     */
    PERM.ORDERS_RECORD_PAYMENT,
    PERM.CUSTOMERS_VIEW,
    PERM.INVENTORY_VIEW,
    PERM.DRIVERS_VIEW,
  ],
};
