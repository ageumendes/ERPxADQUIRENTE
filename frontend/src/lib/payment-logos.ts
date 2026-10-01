import cieloLogo from '../assets/payment-logos/cielo.png';
import vradquirenteLogo from '../assets/payment-logos/vradquirente.png';
import sicrediLogo from '../assets/payment-logos/sicredi.png';
import sipagLogo from '../assets/payment-logos/sipag.png';
import sicoobLogo from '../assets/payment-logos/sicoob.png';
import pluxeeLogo from '../assets/payment-logos/pluxee.png';
import pluxeeadquirenteLogo from '../assets/payment-logos/pluxeeadquirente.png';
import amexLogo from '../assets/payment-logos/amex.png';
import aleloLogo from '../assets/payment-logos/alelo.png';
import cabalLogo from '../assets/payment-logos/cabal.png';
import coopcertoLogo from '../assets/payment-logos/coopcerto.png';
import convcardLogo from '../assets/payment-logos/convcard.png';
import convcard1Logo from '../assets/payment-logos/convicard1.png';
import eloLogo from '../assets/payment-logos/elo.png';
import facerLogo from '../assets/payment-logos/facer.jpg';
import hsfLogo from '../assets/payment-logos/hsf.png';
import mastercardLogo from '../assets/payment-logos/mastercard.png';
import pixLogo from '../assets/payment-logos/pix.png';
import sodexoLogo from '../assets/payment-logos/sodexo.png';
import ticketLogo from '../assets/payment-logos/ticket.png';
import ticketadquirenteLogo from '../assets/payment-logos/ticketadquirente.png';
import visaLogo from '../assets/payment-logos/visa.png';
import voucherLogo from '../assets/payment-logos/voucher.png';
import aleloadquirenteLogo from '../assets/payment-logos/aleloadquirente.png';
import vrLogo from '../assets/payment-logos/vr.png';
import discoverLogo from '../assets/payment-logos/discover.png';
import rupayLogo from '../assets/payment-logos/rupay.png';
import unionpayLogo from '../assets/payment-logos/unionpay.png';
import solloLogo from '../assets/payment-logos/sollo.png';

export const adquirenteLogoMap: Record<string, string> = {
  CIELO: cieloLogo,
  CONVCARD: convcard1Logo,
  'CONV CARD': convcard1Logo,
  SIPAG: sipagLogo,
  SICOOB: sicoobLogo,
  'SICOOB PIX': sicoobLogo,
  'SICOOB PIX QR CODE': sicoobLogo,
  SICREDI: sicrediLogo,
  COOPCERTO: coopcertoLogo,
  ALELO: aleloadquirenteLogo,
  VR: vradquirenteLogo,
  PLUXEE: pluxeeadquirenteLogo,
  TICKET: ticketadquirenteLogo,
};

export const bandeiraLogoMap: Record<string, string> = {
  FACER: facerLogo,
  PIX: pixLogo,
  VISA: visaLogo,
  MASTERCARD: mastercardLogo,
  MASTER: mastercardLogo,
  ELO: eloLogo,
  ALELO: aleloLogo,
  CABAL: cabalLogo,
  SODEXO: sodexoLogo,
  TICKET: ticketLogo,
  VR: vrLogo,
  VOUCHER: voucherLogo,
  CONVCARD: convcardLogo,
  CONVENIO: convcardLogo,
  CONVÊNIO: convcardLogo,
  PLUXEE: pluxeeLogo,
  AMEX: amexLogo,
  DISCOVER: discoverLogo,
  UNIONPAY: unionpayLogo,
  RUPAY: rupayLogo,
  SOLLO: solloLogo,
};

export const erpLogoMap: Record<string, string> = {
  HSF: hsfLogo,
  INTERDATA: hsfLogo,
};
