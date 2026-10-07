/** Brokerages the app can link, as shown in the settings screen. Safe to import from client components. */

export type BrokerId = 'TOSS' | 'KIS' | 'KIWOOM' | 'LS' | 'DB' | 'MERITZ';

export interface BrokerMeta {
  id: BrokerId;
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
    label: '메리츠증권',
    portal: 'https://openapi.imeritz.com',
    keyLabel: 'App Key',
    secretLabel: 'App Secret',
    needsAccount: false,
    paper: false,
    overseas: true,
    note: '메리츠증권 Open API(베타)에서 발급합니다. 앱키에 묶인 계좌를 조회합니다.',
  },
};

export const BROKER_IDS = Object.keys(BROKERS) as BrokerId[];

/** Brokerages people often ask about that cannot be linked from a web server, and why. */
export const UNSUPPORTED_BROKERS: { label: string; reason: string }[] = [
  { label: '하나증권', reason: 'Open API(1Q Pro)가 Windows 전용 ActiveX(OCX)라 웹 서버에서 호출할 수 없습니다.' },
  { label: '미래에셋증권', reason: '개인용으로 공개된 REST Open API를 확인하지 못했습니다.' },
  { label: 'KB증권', reason: 'Open API(오픈베타) 문서가 로그인 후에만 공개되어 있어 아직 연동하지 않았습니다.' },
  { label: 'NH·삼성·신한·대신 등', reason: 'Windows 전용 COM/OCX 방식입니다.' },
];
