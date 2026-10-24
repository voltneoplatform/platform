export interface RecoveryJob {
  agreementId: string;
  number: string;
  approvedAt: string | null;
  disabledOn: string | null;
  dueFrom: string | null;
  driver: { name: string; phone: string; address: string };
  vehicle: string | null;
  battery: { id: string; serial: string; gpsDeviceId: string | null } | null;
}
