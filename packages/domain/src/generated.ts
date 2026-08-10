export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      alert_rule: {
        Row: {
          active: boolean
          condition: string
          created_at: string
          created_by: string
          id: string
          name: string
          severity: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          condition: string
          created_at?: string
          created_by?: string
          id?: string
          name: string
          severity: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          condition?: string
          created_at?: string
          created_by?: string
          id?: string
          name?: string
          severity?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "alert_rule_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          actor_user_id: string | null
          created_at: string
          created_by: string | null
          id: string
          new_data: Json | null
          occurred_at: string
          old_data: Json | null
          operation: string
          record_id: string
          table_name: string
          updated_at: string
        }
        Insert: {
          actor_user_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          new_data?: Json | null
          occurred_at?: string
          old_data?: Json | null
          operation: string
          record_id: string
          table_name: string
          updated_at?: string
        }
        Update: {
          actor_user_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          new_data?: Json | null
          occurred_at?: string
          old_data?: Json | null
          operation?: string
          record_id?: string
          table_name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_log_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
        ]
      }
      background_check: {
        Row: {
          created_at: string
          created_by: string
          document_ref: string
          expires_at: string | null
          id: string
          provider_id: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string
          document_ref: string
          expires_at?: string | null
          id?: string
          provider_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          document_ref?: string
          expires_at?: string | null
          id?: string
          provider_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "background_check_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "background_check_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "provider"
            referencedColumns: ["id"]
          },
        ]
      }
      care_plan: {
        Row: {
          client_id: string
          created_at: string
          created_by: string
          effective_from: string
          id: string
          review_due_at: string | null
          summary: string
          updated_at: string
        }
        Insert: {
          client_id: string
          created_at?: string
          created_by?: string
          effective_from?: string
          id?: string
          review_due_at?: string | null
          summary: string
          updated_at?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          created_by?: string
          effective_from?: string
          id?: string
          review_due_at?: string | null
          summary?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "care_plan_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "care_plan_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
        ]
      }
      client: {
        Row: {
          address: string
          created_at: string
          created_by: string
          date_of_birth: string
          full_name: string
          id: string
          referral_source: string | null
          updated_at: string
          zone_id: string
        }
        Insert: {
          address: string
          created_at?: string
          created_by?: string
          date_of_birth: string
          full_name: string
          id?: string
          referral_source?: string | null
          updated_at?: string
          zone_id: string
        }
        Update: {
          address?: string
          created_at?: string
          created_by?: string
          date_of_birth?: string
          full_name?: string
          id?: string
          referral_source?: string | null
          updated_at?: string
          zone_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "zone"
            referencedColumns: ["id"]
          },
        ]
      }
      client_relationship: {
        Row: {
          client_id: string
          created_at: string
          created_by: string
          id: string
          is_billing_responsible: boolean
          is_decision_maker: boolean
          sponsor_id: string
          updated_at: string
        }
        Insert: {
          client_id: string
          created_at?: string
          created_by?: string
          id?: string
          is_billing_responsible?: boolean
          is_decision_maker?: boolean
          sponsor_id: string
          updated_at?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          created_by?: string
          id?: string
          is_billing_responsible?: boolean
          is_decision_maker?: boolean
          sponsor_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_relationship_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_relationship_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_relationship_sponsor_id_fkey"
            columns: ["sponsor_id"]
            isOneToOne: false
            referencedRelation: "family_sponsor"
            referencedColumns: ["id"]
          },
        ]
      }
      consent_grant: {
        Row: {
          client_id: string
          created_at: string
          created_by: string
          granted_at: string
          grantee_user_id: string
          id: string
          revoked_at: string | null
          scope: string
          updated_at: string
        }
        Insert: {
          client_id: string
          created_at?: string
          created_by?: string
          granted_at?: string
          grantee_user_id: string
          id?: string
          revoked_at?: string | null
          scope: string
          updated_at?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          created_by?: string
          granted_at?: string
          grantee_user_id?: string
          id?: string
          revoked_at?: string | null
          scope?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "consent_grant_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consent_grant_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consent_grant_grantee_user_id_fkey"
            columns: ["grantee_user_id"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
        ]
      }
      consent_record: {
        Row: {
          client_id: string
          created_at: string
          created_by: string
          document_ref: string
          id: string
          signed_at: string
          updated_at: string
        }
        Insert: {
          client_id: string
          created_at?: string
          created_by?: string
          document_ref: string
          id?: string
          signed_at?: string
          updated_at?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          created_by?: string
          document_ref?: string
          id?: string
          signed_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "consent_record_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consent_record_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
        ]
      }
      credential: {
        Row: {
          created_at: string
          created_by: string
          credential_type_id: string
          evidence_document_ref: string | null
          expiry_date: string | null
          id: string
          issuing_authority: string
          provider_id: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string
          credential_type_id: string
          evidence_document_ref?: string | null
          expiry_date?: string | null
          id?: string
          issuing_authority: string
          provider_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          credential_type_id?: string
          evidence_document_ref?: string | null
          expiry_date?: string | null
          id?: string
          issuing_authority?: string
          provider_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "credential_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credential_credential_type_id_fkey"
            columns: ["credential_type_id"]
            isOneToOne: false
            referencedRelation: "credential_type"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credential_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "provider"
            referencedColumns: ["id"]
          },
        ]
      }
      credential_type: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          expiry_period_months: number | null
          id: string
          label: string
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          expiry_period_months?: number | null
          id?: string
          label: string
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          expiry_period_months?: number | null
          id?: string
          label?: string
          slug?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "credential_type_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
        ]
      }
      credential_verification_event: {
        Row: {
          created_at: string
          created_by: string | null
          credential_id: string
          id: string
          notes: string | null
          occurred_at: string
          outcome: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          credential_id: string
          id?: string
          notes?: string | null
          occurred_at?: string
          outcome: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          credential_id?: string
          id?: string
          notes?: string | null
          occurred_at?: string
          outcome?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "credential_verification_event_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credential_verification_event_credential_id_fkey"
            columns: ["credential_id"]
            isOneToOne: false
            referencedRelation: "credential"
            referencedColumns: ["id"]
          },
        ]
      }
      data_retention_policy: {
        Row: {
          created_at: string
          created_by: string
          entity_type: string
          id: string
          retention_days: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string
          entity_type: string
          id?: string
          retention_days: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          entity_type?: string
          id?: string
          retention_days?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "data_retention_policy_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
        ]
      }
      decision_maker_hierarchy: {
        Row: {
          client_id: string
          created_at: string
          created_by: string
          id: string
          priority: number
          sponsor_id: string
          updated_at: string
        }
        Insert: {
          client_id: string
          created_at?: string
          created_by?: string
          id?: string
          priority: number
          sponsor_id: string
          updated_at?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          created_by?: string
          id?: string
          priority?: number
          sponsor_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "decision_maker_hierarchy_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "decision_maker_hierarchy_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "decision_maker_hierarchy_sponsor_id_fkey"
            columns: ["sponsor_id"]
            isOneToOne: false
            referencedRelation: "family_sponsor"
            referencedColumns: ["id"]
          },
        ]
      }
      dpc_registration: {
        Row: {
          created_at: string
          created_by: string
          id: string
          registration_number: string
          renewal_due_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string
          id?: string
          registration_number: string
          renewal_due_at?: string | null
          status: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          registration_number?: string
          renewal_due_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dpc_registration_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
        ]
      }
      emergency_contact: {
        Row: {
          client_id: string
          created_at: string
          created_by: string
          full_name: string
          id: string
          phone: string
          priority: number
          updated_at: string
        }
        Insert: {
          client_id: string
          created_at?: string
          created_by?: string
          full_name: string
          id?: string
          phone: string
          priority: number
          updated_at?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          created_by?: string
          full_name?: string
          id?: string
          phone?: string
          priority?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "emergency_contact_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "emergency_contact_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
        ]
      }
      escalation: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          client_id: string
          created_at: string
          created_by: string
          id: string
          reason: string
          resolution_notes: string | null
          resolved_at: string | null
          resolved_by: string | null
          severity: string
          status: string
          triggered_by_rule_id: string | null
          updated_at: string
          visit_id: string | null
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          client_id: string
          created_at?: string
          created_by?: string
          id?: string
          reason: string
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity: string
          status?: string
          triggered_by_rule_id?: string | null
          updated_at?: string
          visit_id?: string | null
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          client_id?: string
          created_at?: string
          created_by?: string
          id?: string
          reason?: string
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          status?: string
          triggered_by_rule_id?: string | null
          updated_at?: string
          visit_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "escalation_acknowledged_by_fkey"
            columns: ["acknowledged_by"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "escalation_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "escalation_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "escalation_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "escalation_triggered_by_rule_id_fkey"
            columns: ["triggered_by_rule_id"]
            isOneToOne: false
            referencedRelation: "alert_rule"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "escalation_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "visit"
            referencedColumns: ["id"]
          },
        ]
      }
      family_sponsor: {
        Row: {
          client_id: string
          created_at: string
          created_by: string
          id: string
          relationship: string
          updated_at: string
          user_id: string
        }
        Insert: {
          client_id: string
          created_at?: string
          created_by?: string
          id?: string
          relationship: string
          updated_at?: string
          user_id: string
        }
        Update: {
          client_id?: string
          created_at?: string
          created_by?: string
          id?: string
          relationship?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "family_sponsor_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "family_sponsor_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "family_sponsor_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
        ]
      }
      identity_verification: {
        Row: {
          created_at: string
          created_by: string
          id: string
          provider_id: string
          status: string
          updated_at: string
          vendor: string
          verified_at: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string
          id?: string
          provider_id: string
          status?: string
          updated_at?: string
          vendor: string
          verified_at?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          provider_id?: string
          status?: string
          updated_at?: string
          vendor?: string
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "identity_verification_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "identity_verification_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "provider"
            referencedColumns: ["id"]
          },
        ]
      }
      incident_report: {
        Row: {
          client_id: string | null
          created_at: string
          created_by: string
          description: string
          id: string
          provider_id: string | null
          reported_at: string
          severity: string
          updated_at: string
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          created_by?: string
          description: string
          id?: string
          provider_id?: string | null
          reported_at?: string
          severity: string
          updated_at?: string
        }
        Update: {
          client_id?: string | null
          created_at?: string
          created_by?: string
          description?: string
          id?: string
          provider_id?: string | null
          reported_at?: string
          severity?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "incident_report_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_report_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_report_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "provider"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice: {
        Row: {
          amount: number
          client_id: string
          created_at: string
          created_by: string
          currency: string
          due_at: string | null
          id: string
          paid_at: string | null
          status: string
          subscription_id: string
          updated_at: string
        }
        Insert: {
          amount: number
          client_id: string
          created_at?: string
          created_by?: string
          currency: string
          due_at?: string | null
          id?: string
          paid_at?: string | null
          status?: string
          subscription_id: string
          updated_at?: string
        }
        Update: {
          amount?: number
          client_id?: string
          created_at?: string
          created_by?: string
          currency?: string
          due_at?: string | null
          id?: string
          paid_at?: string | null
          status?: string
          subscription_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscription"
            referencedColumns: ["id"]
          },
        ]
      }
      notification: {
        Row: {
          channel: string
          created_at: string
          created_by: string | null
          id: string
          sent_at: string | null
          template_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          channel: string
          created_at?: string
          created_by?: string | null
          id?: string
          sent_at?: string | null
          template_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          channel?: string
          created_at?: string
          created_by?: string | null
          id?: string
          sent_at?: string | null
          template_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
        ]
      }
      observation: {
        Row: {
          created_at: string
          created_by: string
          id: string
          recorded_at: string
          type: string
          updated_at: string
          value: string
          visit_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string
          id?: string
          recorded_at?: string
          type: string
          updated_at?: string
          value: string
          visit_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          recorded_at?: string
          type?: string
          updated_at?: string
          value?: string
          visit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "observation_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "observation_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "visit"
            referencedColumns: ["id"]
          },
        ]
      }
      payment: {
        Row: {
          amount: number
          created_at: string
          created_by: string
          currency: string
          id: string
          invoice_id: string
          paid_at: string | null
          payment_link_url: string | null
          processor: string
          processor_reference: string | null
          status: string
          updated_at: string
        }
        Insert: {
          amount: number
          created_at?: string
          created_by?: string
          currency: string
          id?: string
          invoice_id: string
          paid_at?: string | null
          payment_link_url?: string | null
          processor: string
          processor_reference?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string
          currency?: string
          id?: string
          invoice_id?: string
          paid_at?: string | null
          payment_link_url?: string | null
          processor?: string
          processor_reference?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoice"
            referencedColumns: ["id"]
          },
        ]
      }
      provider: {
        Row: {
          created_at: string
          created_by: string
          departed_at: string | null
          departure_reason: string | null
          employment_status: string
          id: string
          photo_url: string | null
          updated_at: string
          user_id: string
          years_experience: number
        }
        Insert: {
          created_at?: string
          created_by?: string
          departed_at?: string | null
          departure_reason?: string | null
          employment_status?: string
          id?: string
          photo_url?: string | null
          updated_at?: string
          user_id: string
          years_experience?: number
        }
        Update: {
          created_at?: string
          created_by?: string
          departed_at?: string | null
          departure_reason?: string | null
          employment_status?: string
          id?: string
          photo_url?: string | null
          updated_at?: string
          user_id?: string
          years_experience?: number
        }
        Relationships: [
          {
            foreignKeyName: "provider_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
        ]
      }
      role: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          label: string
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          label: string
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          label?: string
          slug?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
        ]
      }
      roster: {
        Row: {
          created_at: string
          created_by: string
          id: string
          provider_id: string
          updated_at: string
          week_starting: string
          zone_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string
          id?: string
          provider_id: string
          updated_at?: string
          week_starting: string
          zone_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          provider_id?: string
          updated_at?: string
          week_starting?: string
          zone_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "roster_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roster_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "provider"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roster_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "zone"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription: {
        Row: {
          amount: number
          billing_interval: string
          client_id: string
          created_at: string
          created_by: string
          currency: string
          id: string
          plan_code: string
          status: string
          updated_at: string
        }
        Insert: {
          amount: number
          billing_interval?: string
          client_id: string
          created_at?: string
          created_by?: string
          currency: string
          id?: string
          plan_code: string
          status?: string
          updated_at?: string
        }
        Update: {
          amount?: number
          billing_interval?: string
          client_id?: string
          created_at?: string
          created_by?: string
          currency?: string
          id?: string
          plan_code?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscription_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
        ]
      }
      task: {
        Row: {
          completed: boolean
          created_at: string
          created_by: string
          description: string
          id: string
          updated_at: string
          visit_id: string
        }
        Insert: {
          completed?: boolean
          created_at?: string
          created_by?: string
          description: string
          id?: string
          updated_at?: string
          visit_id: string
        }
        Update: {
          completed?: boolean
          created_at?: string
          created_by?: string
          description?: string
          id?: string
          updated_at?: string
          visit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "visit"
            referencedColumns: ["id"]
          },
        ]
      }
      training_record: {
        Row: {
          completed_at: string
          cpd_points: number
          created_at: string
          created_by: string
          id: string
          provider_id: string
          title: string
          updated_at: string
        }
        Insert: {
          completed_at?: string
          cpd_points?: number
          created_at?: string
          created_by?: string
          id?: string
          provider_id: string
          title: string
          updated_at?: string
        }
        Update: {
          completed_at?: string
          cpd_points?: number
          created_at?: string
          created_by?: string
          id?: string
          provider_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "training_record_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_record_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "provider"
            referencedColumns: ["id"]
          },
        ]
      }
      user: {
        Row: {
          created_at: string
          created_by: string
          email: string | null
          full_name: string
          id: string
          phone: string | null
          role_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          email?: string | null
          full_name?: string
          id: string
          phone?: string | null
          role_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          email?: string | null
          full_name?: string
          id?: string
          phone?: string | null
          role_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "role"
            referencedColumns: ["id"]
          },
        ]
      }
      verified_profile: {
        Row: {
          background_checked: boolean
          created_at: string
          created_by: string
          id: string
          id_verified: boolean
          nmc_licensed: boolean
          provider_id: string
          training_current: boolean
          updated_at: string
        }
        Insert: {
          background_checked?: boolean
          created_at?: string
          created_by?: string
          id?: string
          id_verified?: boolean
          nmc_licensed?: boolean
          provider_id: string
          training_current?: boolean
          updated_at?: string
        }
        Update: {
          background_checked?: boolean
          created_at?: string
          created_by?: string
          id?: string
          id_verified?: boolean
          nmc_licensed?: boolean
          provider_id?: string
          training_current?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "verified_profile_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "verified_profile_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: true
            referencedRelation: "provider"
            referencedColumns: ["id"]
          },
        ]
      }
      visit: {
        Row: {
          care_plan_id: string
          client_id: string
          created_at: string
          created_by: string
          id: string
          provider_id: string
          scheduled_end: string
          scheduled_start: string
          status: string
          updated_at: string
        }
        Insert: {
          care_plan_id: string
          client_id: string
          created_at?: string
          created_by?: string
          id?: string
          provider_id: string
          scheduled_end: string
          scheduled_start: string
          status?: string
          updated_at?: string
        }
        Update: {
          care_plan_id?: string
          client_id?: string
          created_at?: string
          created_by?: string
          id?: string
          provider_id?: string
          scheduled_end?: string
          scheduled_start?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "visit_care_plan_id_fkey"
            columns: ["care_plan_id"]
            isOneToOne: false
            referencedRelation: "care_plan"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visit_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "client"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visit_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visit_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "provider"
            referencedColumns: ["id"]
          },
        ]
      }
      visit_checkin: {
        Row: {
          created_at: string
          created_by: string
          event: string
          id: string
          occurred_at: string
          updated_at: string
          visit_id: string
          zone_id: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string
          event: string
          id?: string
          occurred_at?: string
          updated_at?: string
          visit_id: string
          zone_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string
          event?: string
          id?: string
          occurred_at?: string
          updated_at?: string
          visit_id?: string
          zone_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "visit_checkin_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visit_checkin_visit_id_fkey"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "visit"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visit_checkin_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "zone"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_message_log: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          sent_at: string
          status: string
          template_name: string
          to_phone: string
          updated_at: string
          wa_message_id: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          sent_at?: string
          status?: string
          template_name: string
          to_phone: string
          updated_at?: string
          wa_message_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          sent_at?: string
          status?: string
          template_name?: string
          to_phone?: string
          updated_at?: string
          wa_message_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_message_log_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
        ]
      }
      zone: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "zone_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      onboard_client_with_care_team: {
        Args: {
          p_address: string
          p_care_summary: string
          p_contacts: Json
          p_date_of_birth: string
          p_full_name: string
          p_referral_source?: string
          p_review_due_at?: string
          p_sponsors: Json
          p_zone_id: string
        }
        Returns: string
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const

