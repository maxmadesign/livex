/**
 * Win card strings added by the rewards integration review: the accessible name of the QR code and
 * the card for a code only this machine can open (reach "loopback"). Registered by
 * src/ui/RewardCard.tsx; the rest of the card's wording lives in src/i18n/strings/ui.*.ts.
 */
import type { StringTable } from '../i18n';

export const rewardCardStrings: StringTable = {
  en: {
    'reward.qrLabel': 'QR code that opens the prize claim page',
    'reward.local': 'No QR code on this kiosk',
    'reward.instr.local': 'Show this code to booth staff to claim your prize',
  },
  zh: {
    'reward.qrLabel': '打开领奖页面的二维码',
    'reward.local': '此展机不显示二维码',
    'reward.instr.local': '向展位工作人员出示此领取码即可领奖',
  },
  ja: {
    'reward.qrLabel': '景品の受け取りページを開くQRコード',
    'reward.local': 'この端末ではQRコードを表示できません',
    'reward.instr.local': 'このコードをブーススタッフに見せて景品を受け取ろう',
  },
};
