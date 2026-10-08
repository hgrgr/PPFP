/** Brokerages and crypto exchanges the app can link, as shown in the settings screen. Safe to import from client components. */

export type BrokerId = 'TOSS' | 'KIS' | 'KIWOOM' | 'LS' | 'DB' | 'MERITZ' | 'UPBIT' | 'BITHUMB' | 'COINONE' | 'KORBIT';
export type BrokerKind = 'stock' | 'crypto';

export interface BrokerMeta {
  id: BrokerId;
  kind: BrokerKind;
  label: string;
  portal: string;
  keyLabel: string;
  secretLabel: string;
  /** The API needs the account number in each request (KIS). */
  needsAccount: boolean;
  /** Offers a separate mock-trading environment. */
  paper: boolean;
  /** Overseas (US) holdings are read too. */
  overseas: boolean;
  note: string;
}

export const BROKERS: Record<BrokerId, BrokerMeta> = {
  TOSS: {
    id: 'TOSS',
    kind: 'stock',
    label: '토스증권',
    portal: 'https://developers.tossinvest.com',
    keyLabel: 'Client ID',
    secretLabel: 'Client Secret',
    needsAccount: false,
    paper: false,
    overseas: true,
    note: '토스증권 Open API 콘솔에서 발급합니다.',
  },
  KIS: {
    id: 'KIS',
    kind: 'stock',
    label: '한국투자증권',
    portal: 'https://apiportal.koreainvestment.com',
    keyLabel: 'App Key',
    secretLabel: 'App Secret',
    needsAccount: true,
    paper: true,
    overseas: true,
    note: 'KIS Developers에서 계좌별로 발급합니다. 한투는 접근토큰을 새로 받을 때마다 카카오 알림톡을 보내므로, 이 앱은 토큰을 암호화해 저장하고 만료될 때만 다시 받습니다.',
  },
  KIWOOM: {
    id: 'KIWOOM',
    kind: 'stock',
    label: '키움증권',
    portal: 'https://openapi.kiwoom.com',
    keyLabel: 'App Key',
    secretLabel: 'Secret Key',
    needsAccount: false,
    paper: true,
    overseas: true,
    note: '키움 REST API 포털에서 발급합니다. 앱키에 묶인 계좌를 조회합니다.',
  },
  LS: {
    id: 'LS',
    kind: 'stock',
    label: 'LS증권',
    portal: 'https://openapi.ls-sec.co.kr',
    keyLabel: 'App Key',
    secretLabel: 'App Secret Key',
    needsAccount: false,
    paper: false,
    overseas: true,
    note: 'LS증권 OPEN API 포털에서 발급합니다. 모의투자는 모의투자용 앱키를 넣으면 됩니다.',
  },
  DB: {
    id: 'DB',
    kind: 'stock',
    label: 'DB증권',
    portal: 'https://openapi.dbsec.co.kr',
    keyLabel: 'App Key',
    secretLabel: 'App Secret Key',
    needsAccount: false,
    paper: false,
    overseas: true,
    note: 'DB증권 Open API 포털에서 발급합니다. 국내 잔고의 평균단가는 매입금액 ÷ 수량으로 계산합니다.',
  },
  MERITZ: {
    id: 'MERITZ',
    kind: 'stock',
    label: '메리츠증권',
    portal: 'https://openapi.imeritz.com',
    keyLabel: 'App Key',
    secretLabel: 'App Secret',
    needsAccount: false,
    paper: false,
    overseas: true,
    note: '메리츠증권 Open API(베타)에서 발급합니다. 앱키에 묶인 계좌를 조회합니다.',
  },
  UPBIT: {
    id: 'UPBIT',
    kind: 'crypto',
    label: '업비트',
    portal: 'https://upbit.com/mypage/open_api_management',
    keyLabel: 'Access Key',
    secretLabel: 'Secret Key',
    needsAccount: false,
    paper: false,
    overseas: false,
    note: '업비트 Open API 관리에서 [자산조회]·[주문조회]·[입금조회]·[출금조회] 권한으로 발급하고, 이 서버의 공인 IP를 허용 IP로 등록하세요. 주문 권한은 필요 없습니다.',
  },
  BITHUMB: {
    id: 'BITHUMB',
    kind: 'crypto',
    label: '빗썸',
    portal: 'https://www.bithumb.com/react/api-support/management-api',
    keyLabel: 'API Key',
    secretLabel: 'Secret Key',
    needsAccount: false,
    paper: false,
    overseas: false,
    note: '빗썸 API 관리에서 자산·주문·입출금 조회 권한으로 발급하고, 허용 IP에 이 서버의 공인 IP를 넣으세요.',
  },
  COINONE: {
    id: 'COINONE',
    kind: 'crypto',
    label: '코인원',
    portal: 'https://coinone.co.kr/developer',
    keyLabel: 'Access Token',
    secretLabel: 'Secret Key',
    needsAccount: false,
    paper: false,
    overseas: false,
    note: '코인원 Open API에서 잔고·주문·입출금 조회 권한으로 발급합니다.',
  },
  KORBIT: {
    id: 'KORBIT',
    kind: 'crypto',
    label: '코빗 (디지털엑스)',
    portal: 'https://developers.digitalx.miraeasset.com',
    keyLabel: 'API Key',
    secretLabel: 'Secret Key (HMAC-SHA256)',
    needsAccount: false,
    paper: false,
    overseas: false,
    note: '코빗은 디지털엑스로 이름이 바뀌었습니다. HMAC-SHA256 키를 조회 권한(잔고·주문·입출금)으로 발급하세요. 이 거래소 API는 주문·체결 내역을 최근 36시간만 주므로, 그 이전 보유분은 평균단가로 보충합니다.',
  },
};

export const BROKER_IDS = Object.keys(BROKERS) as BrokerId[];
export const isCryptoBroker = (id: BrokerId) => BROKERS[id].kind === 'crypto';

/** Brokerages people often ask about that cannot be linked from a web server, and why. */
export const UNSUPPORTED_BROKERS: { label: string; reason: string }[] = [
  { label: '하나증권', reason: 'Open API(1Q Pro)가 Windows 전용 ActiveX(OCX)라 웹 서버에서 호출할 수 없습니다.' },
  { label: '미래에셋증권', reason: '개인용으로 공개된 REST Open API를 확인하지 못했습니다.' },
  { label: 'KB증권', reason: 'Open API(오픈베타) 문서가 로그인 후에만 공개되어 있어 아직 연동하지 않았습니다.' },
  { label: 'NH·삼성·신한·대신 등', reason: 'Windows 전용 COM/OCX 방식입니다.' },
];
