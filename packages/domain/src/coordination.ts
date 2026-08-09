/** Domain 6 — Care Coordination. */

export interface Appointment {
  id: string;
  clientId: string;
  providerNetworkPartnerId: string | null;
  scheduledAt: string;
  purpose: string;
}

export interface Referral {
  id: string;
  clientId: string;
  toPartnerId: string;
  reason: string;
  status: "pending" | "accepted" | "declined" | "completed";
}

export interface TransportBooking {
  id: string;
  clientId: string;
  appointmentId: string | null;
  scheduledAt: string;
  status: "booked" | "en_route" | "completed" | "cancelled";
}

export interface PharmacyOrder {
  id: string;
  clientId: string;
  items: string;
  status: "ordered" | "fulfilled" | "delivered";
}

export interface ProviderNetworkPartner {
  id: string;
  name: string;
  category: "hospital" | "pharmacy" | "transport" | "lab" | "other";
}
