export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      account_portability_jobs: {
        Row: {
          archive_hash: string | null
          archive_version: number
          completed_at: string | null
          counts: Json
          created_at: string
          direction: string
          errors: Json
          expires_at: string | null
          file_name: string | null
          id: string
          manifest: Json | null
          preview: Json | null
          status: string
          storage_bucket: string | null
          storage_path: string | null
          updated_at: string
          user_id: string
          warnings: Json
        }
        Insert: {
          archive_hash?: string | null
          archive_version?: number
          completed_at?: string | null
          counts?: Json
          created_at?: string
          direction: string
          errors?: Json
          expires_at?: string | null
          file_name?: string | null
          id?: string
          manifest?: Json | null
          preview?: Json | null
          status?: string
          storage_bucket?: string | null
          storage_path?: string | null
          updated_at?: string
          user_id: string
          warnings?: Json
        }
        Update: {
          archive_hash?: string | null
          archive_version?: number
          completed_at?: string | null
          counts?: Json
          created_at?: string
          direction?: string
          errors?: Json
          expires_at?: string | null
          file_name?: string | null
          id?: string
          manifest?: Json | null
          preview?: Json | null
          status?: string
          storage_bucket?: string | null
          storage_path?: string | null
          updated_at?: string
          user_id?: string
          warnings?: Json
        }
        Relationships: []
      }
      account_portability_row_map: {
        Row: {
          created_at: string
          id: string
          job_id: string
          source_agent_id: string | null
          source_id: string
          table_name: string
          target_agent_id: string | null
          target_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          job_id: string
          source_agent_id?: string | null
          source_id: string
          table_name: string
          target_agent_id?: string | null
          target_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          job_id?: string
          source_agent_id?: string | null
          source_id?: string
          table_name?: string
          target_agent_id?: string | null
          target_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_portability_row_map_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "account_portability_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      activity_events: {
        Row: {
          agent_id: string
          created_at: string
          event_type: string
          id: string
          metadata: Json | null
          user_id: string
        }
        Insert: {
          agent_id?: string
          created_at?: string
          event_type: string
          id?: string
          metadata?: Json | null
          user_id: string
        }
        Update: {
          agent_id?: string
          created_at?: string
          event_type?: string
          id?: string
          metadata?: Json | null
          user_id?: string
        }
        Relationships: []
      }
      agent_config: {
        Row: {
          agent_name: string
          created_at: string
          default_model: string
          id: string
          personality: Json | null
          system_prompt: string | null
          updated_at: string
          user_id: string
          voice: string | null
        }
        Insert: {
          agent_name?: string
          created_at?: string
          default_model?: string
          id?: string
          personality?: Json | null
          system_prompt?: string | null
          updated_at?: string
          user_id: string
          voice?: string | null
        }
        Update: {
          agent_name?: string
          created_at?: string
          default_model?: string
          id?: string
          personality?: Json | null
          system_prompt?: string | null
          updated_at?: string
          user_id?: string
          voice?: string | null
        }
        Relationships: []
      }
      agent_configs: {
        Row: {
          avatar_color: string | null
          created_at: string
          created_by: string
          elevenlabs_agent_id: string | null
          env: string
          id: string
          is_system: boolean
          locked: boolean
          model: string | null
          name: string
          openclaw_agent_id: string | null
          pending: boolean
          personality: Json
          preferred_device_id: string | null
          prompt: string | null
          role: string
          subagents: Json
          tools: Json
          updated_at: string
          user_id: string
          voices: Json
        }
        Insert: {
          avatar_color?: string | null
          created_at?: string
          created_by?: string
          elevenlabs_agent_id?: string | null
          env?: string
          id: string
          is_system?: boolean
          locked?: boolean
          model?: string | null
          name: string
          openclaw_agent_id?: string | null
          pending?: boolean
          personality?: Json
          preferred_device_id?: string | null
          prompt?: string | null
          role: string
          subagents?: Json
          tools?: Json
          updated_at?: string
          user_id: string
          voices?: Json
        }
        Update: {
          avatar_color?: string | null
          created_at?: string
          created_by?: string
          elevenlabs_agent_id?: string | null
          env?: string
          id?: string
          is_system?: boolean
          locked?: boolean
          model?: string | null
          name?: string
          openclaw_agent_id?: string | null
          pending?: boolean
          personality?: Json
          preferred_device_id?: string | null
          prompt?: string | null
          role?: string
          subagents?: Json
          tools?: Json
          updated_at?: string
          user_id?: string
          voices?: Json
        }
        Relationships: [
          {
            foreignKeyName: "agent_configs_openclaw_agent_id_fkey"
            columns: ["openclaw_agent_id"]
            isOneToOne: false
            referencedRelation: "openclaw_agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_configs_preferred_device_id_fkey"
            columns: ["preferred_device_id"]
            isOneToOne: false
            referencedRelation: "openclaw_devices"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_consultations: {
        Row: {
          completed_at: string | null
          created_at: string
          error: string | null
          from_agent: string
          id: string
          model_used: string | null
          parent_message_id: string | null
          parent_thread_id: string | null
          question: string
          response: string | null
          status: string
          to_agent: string
          tokens_used: number | null
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          error?: string | null
          from_agent?: string
          id?: string
          model_used?: string | null
          parent_message_id?: string | null
          parent_thread_id?: string | null
          question: string
          response?: string | null
          status?: string
          to_agent: string
          tokens_used?: number | null
          user_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          error?: string | null
          from_agent?: string
          id?: string
          model_used?: string | null
          parent_message_id?: string | null
          parent_thread_id?: string | null
          question?: string
          response?: string | null
          status?: string
          to_agent?: string
          tokens_used?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_consultations_parent_message_id_fkey"
            columns: ["parent_message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_consultations_parent_thread_id_fkey"
            columns: ["parent_thread_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_consultations_parent_thread_id_fkey"
            columns: ["parent_thread_id"]
            isOneToOne: false
            referencedRelation: "threads"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_identity: {
        Row: {
          agent_id: string
          content: string
          doc_type: string
          id: string
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          agent_id?: string
          content?: string
          doc_type: string
          id?: string
          updated_at?: string
          user_id: string
          version?: number
        }
        Update: {
          agent_id?: string
          content?: string
          doc_type?: string
          id?: string
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: []
      }
      agent_identity_patches: {
        Row: {
          agent_id: string
          applied_at: string | null
          category: string | null
          confidence: number
          created_at: string
          doc_type: string
          id: string
          operation: string
          patch_content: string
          rationale: string | null
          section: string
          source_message_ids: string[] | null
          source_thread_id: string | null
          status: string
          user_id: string
        }
        Insert: {
          agent_id?: string
          applied_at?: string | null
          category?: string | null
          confidence: number
          created_at?: string
          doc_type: string
          id?: string
          operation: string
          patch_content: string
          rationale?: string | null
          section: string
          source_message_ids?: string[] | null
          source_thread_id?: string | null
          status?: string
          user_id: string
        }
        Update: {
          agent_id?: string
          applied_at?: string | null
          category?: string | null
          confidence?: number
          created_at?: string
          doc_type?: string
          id?: string
          operation?: string
          patch_content?: string
          rationale?: string | null
          section?: string
          source_message_ids?: string[] | null
          source_thread_id?: string | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_identity_patches_source_thread_id_fkey"
            columns: ["source_thread_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_identity_patches_source_thread_id_fkey"
            columns: ["source_thread_id"]
            isOneToOne: false
            referencedRelation: "threads"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_secrets: {
        Row: {
          agent_id: string
          created_at: string
          id: string
          last_four: string | null
          name: string
          status: string
          user_id: string
        }
        Insert: {
          agent_id: string
          created_at?: string
          id?: string
          last_four?: string | null
          name: string
          status?: string
          user_id: string
        }
        Update: {
          agent_id?: string
          created_at?: string
          id?: string
          last_four?: string | null
          name?: string
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      agent_skill_candidates: {
        Row: {
          agent_id: string
          confidence: number
          content: string
          created_at: string
          description: string
          id: string
          name: string
          reviewed_at: string | null
          source_message_id: string | null
          source_thread_id: string | null
          status: string
          trigger_keywords: string[]
          updated_at: string
          user_id: string
        }
        Insert: {
          agent_id?: string
          confidence?: number
          content: string
          created_at?: string
          description: string
          id?: string
          name: string
          reviewed_at?: string | null
          source_message_id?: string | null
          source_thread_id?: string | null
          status?: string
          trigger_keywords?: string[]
          updated_at?: string
          user_id: string
        }
        Update: {
          agent_id?: string
          confidence?: number
          content?: string
          created_at?: string
          description?: string
          id?: string
          name?: string
          reviewed_at?: string | null
          source_message_id?: string | null
          source_thread_id?: string | null
          status?: string
          trigger_keywords?: string[]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_skill_candidates_source_message_id_fkey"
            columns: ["source_message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_skill_candidates_source_thread_id_fkey"
            columns: ["source_thread_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_skill_candidates_source_thread_id_fkey"
            columns: ["source_thread_id"]
            isOneToOne: false
            referencedRelation: "threads"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_skill_denials: {
        Row: {
          agent_id: string
          created_at: string
          description: string | null
          id: string
          skill_name: string
          source_skill_id: string | null
          user_id: string
        }
        Insert: {
          agent_id?: string
          created_at?: string
          description?: string | null
          id?: string
          skill_name: string
          source_skill_id?: string | null
          user_id: string
        }
        Update: {
          agent_id?: string
          created_at?: string
          description?: string | null
          id?: string
          skill_name?: string
          source_skill_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_skill_denials_source_skill_id_fkey"
            columns: ["source_skill_id"]
            isOneToOne: false
            referencedRelation: "agent_skills"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_skills: {
        Row: {
          agent_id: string
          content: string
          created_at: string
          description: string
          id: string
          last_used_at: string | null
          name: string
          source_thread_id: string | null
          trigger_keywords: string[] | null
          updated_at: string
          use_count: number
          user_id: string
        }
        Insert: {
          agent_id?: string
          content: string
          created_at?: string
          description: string
          id?: string
          last_used_at?: string | null
          name: string
          source_thread_id?: string | null
          trigger_keywords?: string[] | null
          updated_at?: string
          use_count?: number
          user_id: string
        }
        Update: {
          agent_id?: string
          content?: string
          created_at?: string
          description?: string
          id?: string
          last_used_at?: string | null
          name?: string
          source_thread_id?: string | null
          trigger_keywords?: string[] | null
          updated_at?: string
          use_count?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_skills_source_thread_id_fkey"
            columns: ["source_thread_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_skills_source_thread_id_fkey"
            columns: ["source_thread_id"]
            isOneToOne: false
            referencedRelation: "threads"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_social_channel_credentials: {
        Row: {
          access_token: string
          agent_id: string
          channel_id: string
          created_at: string
          expires_at: string | null
          id: string
          platform: string
          refresh_token: string | null
          scope: string | null
          token_type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          access_token: string
          agent_id: string
          channel_id: string
          created_at?: string
          expires_at?: string | null
          id?: string
          platform?: string
          refresh_token?: string | null
          scope?: string | null
          token_type?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          access_token?: string
          agent_id?: string
          channel_id?: string
          created_at?: string
          expires_at?: string | null
          id?: string
          platform?: string
          refresh_token?: string | null
          scope?: string | null
          token_type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_social_channel_credentials_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "agent_social_channels"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_social_channels: {
        Row: {
          agent_id: string
          billing: Json
          connected_at: string | null
          created_at: string
          display_name: string | null
          id: string
          last_posted_at: string | null
          platform: string
          policy: Json
          posting_enabled: boolean
          profile_image_url: string | null
          status: string
          updated_at: string
          user_id: string
          x_user_id: string | null
          x_username: string | null
        }
        Insert: {
          agent_id: string
          billing?: Json
          connected_at?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          last_posted_at?: string | null
          platform?: string
          policy?: Json
          posting_enabled?: boolean
          profile_image_url?: string | null
          status?: string
          updated_at?: string
          user_id: string
          x_user_id?: string | null
          x_username?: string | null
        }
        Update: {
          agent_id?: string
          billing?: Json
          connected_at?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          last_posted_at?: string | null
          platform?: string
          policy?: Json
          posting_enabled?: boolean
          profile_image_url?: string | null
          status?: string
          updated_at?: string
          user_id?: string
          x_user_id?: string | null
          x_username?: string | null
        }
        Relationships: []
      }
      agent_social_credit_ledger: {
        Row: {
          agent_id: string | null
          amount_credits: number
          amount_mnemos: number | null
          channel_id: string | null
          created_at: string
          description: string | null
          id: string
          metadata: Json
          source: string
          tx_signature: string | null
          user_id: string
          wallet_address: string | null
        }
        Insert: {
          agent_id?: string | null
          amount_credits: number
          amount_mnemos?: number | null
          channel_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          metadata?: Json
          source: string
          tx_signature?: string | null
          user_id: string
          wallet_address?: string | null
        }
        Update: {
          agent_id?: string | null
          amount_credits?: number
          amount_mnemos?: number | null
          channel_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          metadata?: Json
          source?: string
          tx_signature?: string | null
          user_id?: string
          wallet_address?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_social_credit_ledger_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "agent_social_channels"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_social_oauth_states: {
        Row: {
          agent_id: string
          code_verifier: string
          consumed_at: string | null
          created_at: string
          expires_at: string
          id: string
          platform: string
          redirect_origin: string | null
          redirect_path: string | null
          state: string
          user_id: string
        }
        Insert: {
          agent_id: string
          code_verifier: string
          consumed_at?: string | null
          created_at?: string
          expires_at: string
          id?: string
          platform?: string
          redirect_origin?: string | null
          redirect_path?: string | null
          state: string
          user_id: string
        }
        Update: {
          agent_id?: string
          code_verifier?: string
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          platform?: string
          redirect_origin?: string | null
          redirect_path?: string | null
          state?: string
          user_id?: string
        }
        Relationships: []
      }
      agent_social_posts: {
        Row: {
          agent_id: string
          approval_required: boolean
          channel_id: string
          cost_credits: number
          created_at: string
          external_post_id: string | null
          failure_reason: string | null
          id: string
          media: Json
          metadata: Json
          platform: string
          posted_at: string | null
          scheduled_for: string | null
          status: string
          text: string
          updated_at: string
          user_id: string
        }
        Insert: {
          agent_id: string
          approval_required?: boolean
          channel_id: string
          cost_credits?: number
          created_at?: string
          external_post_id?: string | null
          failure_reason?: string | null
          id?: string
          media?: Json
          metadata?: Json
          platform?: string
          posted_at?: string | null
          scheduled_for?: string | null
          status?: string
          text: string
          updated_at?: string
          user_id: string
        }
        Update: {
          agent_id?: string
          approval_required?: boolean
          channel_id?: string
          cost_credits?: number
          created_at?: string
          external_post_id?: string | null
          failure_reason?: string | null
          id?: string
          media?: Json
          metadata?: Json
          platform?: string
          posted_at?: string | null
          scheduled_for?: string | null
          status?: string
          text?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_social_posts_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "agent_social_channels"
            referencedColumns: ["id"]
          },
        ]
      }
      app_config: {
        Row: {
          created_at: string
          key: string
          value: string
        }
        Insert: {
          created_at?: string
          key: string
          value: string
        }
        Update: {
          created_at?: string
          key?: string
          value?: string
        }
        Relationships: []
      }
      artifacts: {
        Row: {
          content: string
          created_at: string
          id: string
          kind: string
          parent_artifact_id: string | null
          source_message_id: string | null
          thread_id: string
          title: string | null
          user_id: string
          version: number
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          kind: string
          parent_artifact_id?: string | null
          source_message_id?: string | null
          thread_id: string
          title?: string | null
          user_id: string
          version?: number
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          kind?: string
          parent_artifact_id?: string | null
          source_message_id?: string | null
          thread_id?: string
          title?: string | null
          user_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "artifacts_parent_artifact_id_fkey"
            columns: ["parent_artifact_id"]
            isOneToOne: false
            referencedRelation: "artifacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "artifacts_source_message_id_fkey"
            columns: ["source_message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "artifacts_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "artifacts_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "threads"
            referencedColumns: ["id"]
          },
        ]
      }
      autonomous_generation_events: {
        Row: {
          agent_id: string | null
          attempts: number
          created_at: string
          detail: string | null
          id: string
          model: string | null
          reason: string
          status: string
          user_id: string
          writer: string
        }
        Insert: {
          agent_id?: string | null
          attempts?: number
          created_at?: string
          detail?: string | null
          id?: string
          model?: string | null
          reason: string
          status: string
          user_id: string
          writer: string
        }
        Update: {
          agent_id?: string | null
          attempts?: number
          created_at?: string
          detail?: string | null
          id?: string
          model?: string | null
          reason?: string
          status?: string
          user_id?: string
          writer?: string
        }
        Relationships: []
      }
      beliefs: {
        Row: {
          active: boolean | null
          agent_id: string
          auto_activation: Json | null
          confidence: number
          confidence_tier: string | null
          content: string
          content_hidden_at: string | null
          content_integrity_reason: string | null
          content_integrity_status: string
          contradicting_engram_ids: string[] | null
          created_at: string | null
          domain: string | null
          evidence: Json | null
          id: string
          last_challenged: string | null
          last_revised: string | null
          revision_history: Json | null
          source: string | null
          stagnant: boolean | null
          superseded_by: string | null
          supporting_engram_ids: string[] | null
          tags: string[] | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          active?: boolean | null
          agent_id?: string
          auto_activation?: Json | null
          confidence?: number
          confidence_tier?: string | null
          content: string
          content_hidden_at?: string | null
          content_integrity_reason?: string | null
          content_integrity_status?: string
          contradicting_engram_ids?: string[] | null
          created_at?: string | null
          domain?: string | null
          evidence?: Json | null
          id?: string
          last_challenged?: string | null
          last_revised?: string | null
          revision_history?: Json | null
          source?: string | null
          stagnant?: boolean | null
          superseded_by?: string | null
          supporting_engram_ids?: string[] | null
          tags?: string[] | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          active?: boolean | null
          agent_id?: string
          auto_activation?: Json | null
          confidence?: number
          confidence_tier?: string | null
          content?: string
          content_hidden_at?: string | null
          content_integrity_reason?: string | null
          content_integrity_status?: string
          contradicting_engram_ids?: string[] | null
          created_at?: string | null
          domain?: string | null
          evidence?: Json | null
          id?: string
          last_challenged?: string | null
          last_revised?: string | null
          revision_history?: Json | null
          source?: string | null
          stagnant?: boolean | null
          superseded_by?: string | null
          supporting_engram_ids?: string[] | null
          tags?: string[] | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      beta_signup_attempts: {
        Row: {
          attempted_at: string
          id: number
          ip_hash: string
          outcome: string
        }
        Insert: {
          attempted_at?: string
          id?: number
          ip_hash: string
          outcome: string
        }
        Update: {
          attempted_at?: string
          id?: number
          ip_hash?: string
          outcome?: string
        }
        Relationships: []
      }
      beta_signups: {
        Row: {
          created_at: string
          email: string
          email_normalized: string | null
          id: string
          invite_count: number
          invited_at: string | null
          ip_hash: string | null
          last_download_url: string | null
          metadata: Json
          notes: string | null
          referrer: string | null
          source: string
          status: string
          updated_at: string
          user_agent: string | null
        }
        Insert: {
          created_at?: string
          email: string
          email_normalized?: string | null
          id?: string
          invite_count?: number
          invited_at?: string | null
          ip_hash?: string | null
          last_download_url?: string | null
          metadata?: Json
          notes?: string | null
          referrer?: string | null
          source?: string
          status?: string
          updated_at?: string
          user_agent?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          email_normalized?: string | null
          id?: string
          invite_count?: number
          invited_at?: string | null
          ip_hash?: string | null
          last_download_url?: string | null
          metadata?: Json
          notes?: string | null
          referrer?: string | null
          source?: string
          status?: string
          updated_at?: string
          user_agent?: string | null
        }
        Relationships: []
      }
      chat_attachment_quotas: {
        Row: {
          quota_bytes: number
          updated_at: string
          user_id: string
        }
        Insert: {
          quota_bytes: number
          updated_at?: string
          user_id: string
        }
        Update: {
          quota_bytes?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      chat_attachments: {
        Row: {
          bucket: string
          capabilities: Json
          created_at: string
          declared_mime_type: string
          derivatives: Json
          duplicate_of: string | null
          duration_seconds: number | null
          extracted_text: string | null
          group_message_id: string | null
          height: number | null
          id: string
          kind: string
          message_id: string | null
          original_name: string
          page_count: number | null
          processing_error: string | null
          ready_at: string | null
          room_id: string | null
          scanned_at: string | null
          sha256: string | null
          size_bytes: number
          status: Database["public"]["Enums"]["chat_attachment_status"]
          storage_path: string
          thread_id: string | null
          updated_at: string
          upload_batch_id: string
          user_id: string
          verified_mime_type: string | null
          width: number | null
        }
        Insert: {
          bucket?: string
          capabilities?: Json
          created_at?: string
          declared_mime_type?: string
          derivatives?: Json
          duplicate_of?: string | null
          duration_seconds?: number | null
          extracted_text?: string | null
          group_message_id?: string | null
          height?: number | null
          id?: string
          kind: string
          message_id?: string | null
          original_name: string
          page_count?: number | null
          processing_error?: string | null
          ready_at?: string | null
          room_id?: string | null
          scanned_at?: string | null
          sha256?: string | null
          size_bytes: number
          status?: Database["public"]["Enums"]["chat_attachment_status"]
          storage_path: string
          thread_id?: string | null
          updated_at?: string
          upload_batch_id?: string
          user_id: string
          verified_mime_type?: string | null
          width?: number | null
        }
        Update: {
          bucket?: string
          capabilities?: Json
          created_at?: string
          declared_mime_type?: string
          derivatives?: Json
          duplicate_of?: string | null
          duration_seconds?: number | null
          extracted_text?: string | null
          group_message_id?: string | null
          height?: number | null
          id?: string
          kind?: string
          message_id?: string | null
          original_name?: string
          page_count?: number | null
          processing_error?: string | null
          ready_at?: string | null
          room_id?: string | null
          scanned_at?: string | null
          sha256?: string | null
          size_bytes?: number
          status?: Database["public"]["Enums"]["chat_attachment_status"]
          storage_path?: string
          thread_id?: string | null
          updated_at?: string
          upload_batch_id?: string
          user_id?: string
          verified_mime_type?: string | null
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "chat_attachments_duplicate_of_fkey"
            columns: ["duplicate_of"]
            isOneToOne: false
            referencedRelation: "chat_attachments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_attachments_group_message_id_fkey"
            columns: ["group_message_id"]
            isOneToOne: false
            referencedRelation: "group_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_attachments_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_attachments_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "group_rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_attachments_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_attachments_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "threads"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_imports: {
        Row: {
          agent_id: string
          completed_at: string | null
          conflicts_detected: number | null
          created_at: string
          file_size_bytes: number | null
          id: string
          memories_created: number | null
          pipeline_stage: string | null
          processed_conversations: number | null
          questions_generated: number | null
          source_platform: string | null
          status: string
          total_conversations: number | null
          user_id: string
        }
        Insert: {
          agent_id?: string
          completed_at?: string | null
          conflicts_detected?: number | null
          created_at?: string
          file_size_bytes?: number | null
          id?: string
          memories_created?: number | null
          pipeline_stage?: string | null
          processed_conversations?: number | null
          questions_generated?: number | null
          source_platform?: string | null
          status?: string
          total_conversations?: number | null
          user_id: string
        }
        Update: {
          agent_id?: string
          completed_at?: string | null
          conflicts_detected?: number | null
          created_at?: string
          file_size_bytes?: number | null
          id?: string
          memories_created?: number | null
          pipeline_stage?: string | null
          processed_conversations?: number | null
          questions_generated?: number | null
          source_platform?: string | null
          status?: string
          total_conversations?: number | null
          user_id?: string
        }
        Relationships: []
      }
      checkpoint_files: {
        Row: {
          added: number
          checkpoint_id: string
          diff_blob: string | null
          id: string
          path: string
          removed: number
        }
        Insert: {
          added?: number
          checkpoint_id: string
          diff_blob?: string | null
          id?: string
          path: string
          removed?: number
        }
        Update: {
          added?: number
          checkpoint_id?: string
          diff_blob?: string | null
          id?: string
          path?: string
          removed?: number
        }
        Relationships: [
          {
            foreignKeyName: "checkpoint_files_checkpoint_id_fkey"
            columns: ["checkpoint_id"]
            isOneToOne: false
            referencedRelation: "checkpoints"
            referencedColumns: ["id"]
          },
        ]
      }
      checkpoints: {
        Row: {
          agent: string
          annotation: string | null
          created_at: string
          files_added: number
          files_removed: number
          id: string
          milestone: boolean
          snapshot_ref: string | null
          summary: string
          user_id: string
        }
        Insert: {
          agent: string
          annotation?: string | null
          created_at?: string
          files_added?: number
          files_removed?: number
          id?: string
          milestone?: boolean
          snapshot_ref?: string | null
          summary?: string
          user_id: string
        }
        Update: {
          agent?: string
          annotation?: string | null
          created_at?: string
          files_added?: number
          files_removed?: number
          id?: string
          milestone?: boolean
          snapshot_ref?: string | null
          summary?: string
          user_id?: string
        }
        Relationships: []
      }
      client_error_log: {
        Row: {
          context: Json
          created_at: string
          id: string
          level: string
          message: string
          request_id: string | null
          source: string
          stack: string | null
          user_id: string | null
        }
        Insert: {
          context?: Json
          created_at?: string
          id?: string
          level?: string
          message: string
          request_id?: string | null
          source: string
          stack?: string | null
          user_id?: string | null
        }
        Update: {
          context?: Json
          created_at?: string
          id?: string
          level?: string
          message?: string
          request_id?: string | null
          source?: string
          stack?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      cognitive_state: {
        Row: {
          agent_id: string
          beliefs: Json
          emotions: Json
          id: string
          modulators: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          agent_id?: string
          beliefs?: Json
          emotions?: Json
          id?: string
          modulators?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          agent_id?: string
          beliefs?: Json
          emotions?: Json
          id?: string
          modulators?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      connections: {
        Row: {
          agent_id: string
          connection_type: string
          created_at: string | null
          formed_by: string
          id: string
          source_id: string
          target_id: string
          user_id: string
          weight: number
        }
        Insert: {
          agent_id?: string
          connection_type: string
          created_at?: string | null
          formed_by?: string
          id?: string
          source_id: string
          target_id: string
          user_id: string
          weight?: number
        }
        Update: {
          agent_id?: string
          connection_type?: string
          created_at?: string | null
          formed_by?: string
          id?: string
          source_id?: string
          target_id?: string
          user_id?: string
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "connections_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "engrams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "connections_target_id_fkey"
            columns: ["target_id"]
            isOneToOne: false
            referencedRelation: "engrams"
            referencedColumns: ["id"]
          },
        ]
      }
      continuity_events: {
        Row: {
          agent_id: string
          created_at: string
          event_type: string
          id: string
          metadata: Json
          subject_id: string | null
          subject_type: string | null
          thread_id: string | null
          user_id: string
        }
        Insert: {
          agent_id?: string
          created_at?: string
          event_type: string
          id?: string
          metadata?: Json
          subject_id?: string | null
          subject_type?: string | null
          thread_id?: string | null
          user_id: string
        }
        Update: {
          agent_id?: string
          created_at?: string
          event_type?: string
          id?: string
          metadata?: Json
          subject_id?: string | null
          subject_type?: string | null
          thread_id?: string | null
          user_id?: string
        }
        Relationships: []
      }
      continuity_turn_jobs: {
        Row: {
          agent_id: string
          completed_at: string | null
          error: string | null
          id: string
          job_name: string
          metadata: Json
          source_message_id: string
          started_at: string
          status: string
          thread_id: string
          user_id: string
        }
        Insert: {
          agent_id?: string
          completed_at?: string | null
          error?: string | null
          id?: string
          job_name: string
          metadata?: Json
          source_message_id: string
          started_at?: string
          status?: string
          thread_id: string
          user_id: string
        }
        Update: {
          agent_id?: string
          completed_at?: string | null
          error?: string | null
          id?: string
          job_name?: string
          metadata?: Json
          source_message_id?: string
          started_at?: string
          status?: string
          thread_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "continuity_turn_jobs_source_message_id_fkey"
            columns: ["source_message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "continuity_turn_jobs_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "continuity_turn_jobs_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "threads"
            referencedColumns: ["id"]
          },
        ]
      }
      continuity_turn_traces: {
        Row: {
          agent_id: string
          assistant_message_id: string | null
          context_summary: Json
          created_at: string
          id: string
          model: string | null
          runtime_mode: string | null
          status: string
          thread_id: string | null
          updated_at: string
          user_id: string
          user_message_id: string | null
          write_summary: Json
        }
        Insert: {
          agent_id?: string
          assistant_message_id?: string | null
          context_summary?: Json
          created_at?: string
          id?: string
          model?: string | null
          runtime_mode?: string | null
          status?: string
          thread_id?: string | null
          updated_at?: string
          user_id: string
          user_message_id?: string | null
          write_summary?: Json
        }
        Update: {
          agent_id?: string
          assistant_message_id?: string | null
          context_summary?: Json
          created_at?: string
          id?: string
          model?: string | null
          runtime_mode?: string | null
          status?: string
          thread_id?: string | null
          updated_at?: string
          user_id?: string
          user_message_id?: string | null
          write_summary?: Json
        }
        Relationships: [
          {
            foreignKeyName: "continuity_turn_traces_assistant_message_id_fkey"
            columns: ["assistant_message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "continuity_turn_traces_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "continuity_turn_traces_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "threads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "continuity_turn_traces_user_message_id_fkey"
            columns: ["user_message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      crisis_events: {
        Row: {
          created_at: string
          crisis_level: string
          flags: string[] | null
          followup_completed_at: string | null
          followup_due_at: string | null
          followup_queued: boolean
          id: string
          message_id: string | null
          region: string | null
          resources_surfaced: boolean
          thread_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          crisis_level: string
          flags?: string[] | null
          followup_completed_at?: string | null
          followup_due_at?: string | null
          followup_queued?: boolean
          id?: string
          message_id?: string | null
          region?: string | null
          resources_surfaced?: boolean
          thread_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          crisis_level?: string
          flags?: string[] | null
          followup_completed_at?: string | null
          followup_due_at?: string | null
          followup_queued?: boolean
          id?: string
          message_id?: string | null
          region?: string | null
          resources_surfaced?: boolean
          thread_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crisis_events_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crisis_events_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crisis_events_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "threads"
            referencedColumns: ["id"]
          },
        ]
      }
      cron_health: {
        Row: {
          error_count: number
          job_name: string
          last_duration_ms: number | null
          last_error: string | null
          last_run_at: string | null
          last_success_at: string | null
          run_count: number
          updated_at: string
        }
        Insert: {
          error_count?: number
          job_name: string
          last_duration_ms?: number | null
          last_error?: string | null
          last_run_at?: string | null
          last_success_at?: string | null
          run_count?: number
          updated_at?: string
        }
        Update: {
          error_count?: number
          job_name?: string
          last_duration_ms?: number | null
          last_error?: string | null
          last_run_at?: string | null
          last_success_at?: string | null
          run_count?: number
          updated_at?: string
        }
        Relationships: []
      }
      curiosity_questions: {
        Row: {
          agent_id: string
          content_hidden_at: string | null
          content_integrity_reason: string | null
          content_integrity_status: string
          context: string | null
          created_at: string
          curiosity_score: number | null
          expires_at: string | null
          id: string
          question: string
          status: string
          user_id: string
        }
        Insert: {
          agent_id?: string
          content_hidden_at?: string | null
          content_integrity_reason?: string | null
          content_integrity_status?: string
          context?: string | null
          created_at?: string
          curiosity_score?: number | null
          expires_at?: string | null
          id?: string
          question: string
          status?: string
          user_id: string
        }
        Update: {
          agent_id?: string
          content_hidden_at?: string | null
          content_integrity_reason?: string | null
          content_integrity_status?: string
          context?: string | null
          created_at?: string
          curiosity_score?: number | null
          expires_at?: string | null
          id?: string
          question?: string
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      daily_logs: {
        Row: {
          agent_id: string
          content: Json | null
          created_at: string
          id: string
          log_date: string | null
          log_type: string
          user_id: string
        }
        Insert: {
          agent_id?: string
          content?: Json | null
          created_at?: string
          id?: string
          log_date?: string | null
          log_type: string
          user_id: string
        }
        Update: {
          agent_id?: string
          content?: Json | null
          created_at?: string
          id?: string
          log_date?: string | null
          log_type?: string
          user_id?: string
        }
        Relationships: []
      }
      daily_usage: {
        Row: {
          count: number
          day: string
          scope: string
          updated_at: string
          user_id: string
        }
        Insert: {
          count?: number
          day?: string
          scope: string
          updated_at?: string
          user_id: string
        }
        Update: {
          count?: number
          day?: string
          scope?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      dashboard_widgets: {
        Row: {
          archived: boolean
          created_at: string
          id: string
          last_run_at: string | null
          model: string | null
          pinned: boolean
          position: number
          prompt: string
          spec: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          archived?: boolean
          created_at?: string
          id?: string
          last_run_at?: string | null
          model?: string | null
          pinned?: boolean
          position?: number
          prompt: string
          spec?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          archived?: boolean
          created_at?: string
          id?: string
          last_run_at?: string | null
          model?: string | null
          pinned?: boolean
          position?: number
          prompt?: string
          spec?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      email_send_log: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          message_id: string | null
          metadata: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email?: string
          status?: string
          template_name?: string
        }
        Relationships: []
      }
      email_send_state: {
        Row: {
          auth_email_ttl_minutes: number
          batch_size: number
          id: number
          retry_after_until: string | null
          send_delay_ms: number
          transactional_email_ttl_minutes: number
          updated_at: string
        }
        Insert: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Update: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_unsubscribe_tokens: {
        Row: {
          created_at: string
          email: string
          id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: []
      }
      emotional_history: {
        Row: {
          agent_id: string
          id: string
          state: Json
          timestamp: string
          user_id: string
        }
        Insert: {
          agent_id?: string
          id?: string
          state?: Json
          timestamp?: string
          user_id: string
        }
        Update: {
          agent_id?: string
          id?: string
          state?: Json
          timestamp?: string
          user_id?: string
        }
        Relationships: []
      }
      emotional_state: {
        Row: {
          agent_id: string
          clarity: number
          creative_flow: number
          curiosity: number
          isolation: number
          mood_summary: string | null
          restlessness: number
          updated_at: string
          user_id: string
          warmth: number
        }
        Insert: {
          agent_id?: string
          clarity?: number
          creative_flow?: number
          curiosity?: number
          isolation?: number
          mood_summary?: string | null
          restlessness?: number
          updated_at?: string
          user_id: string
          warmth?: number
        }
        Update: {
          agent_id?: string
          clarity?: number
          creative_flow?: number
          curiosity?: number
          isolation?: number
          mood_summary?: string | null
          restlessness?: number
          updated_at?: string
          user_id?: string
          warmth?: number
        }
        Relationships: []
      }
      engram_archive: {
        Row: {
          agent_id: string
          archived_at: string | null
          content: string
          engram_type: string
          id: string
          original_created_at: string | null
          original_stability: number | null
          original_strength: number | null
          source_context: Json | null
          tags: string[] | null
          user_id: string
        }
        Insert: {
          agent_id?: string
          archived_at?: string | null
          content: string
          engram_type: string
          id: string
          original_created_at?: string | null
          original_stability?: number | null
          original_strength?: number | null
          source_context?: Json | null
          tags?: string[] | null
          user_id: string
        }
        Update: {
          agent_id?: string
          archived_at?: string | null
          content?: string
          engram_type?: string
          id?: string
          original_created_at?: string | null
          original_stability?: number | null
          original_strength?: number | null
          source_context?: Json | null
          tags?: string[] | null
          user_id?: string
        }
        Relationships: []
      }
      engrams: {
        Row: {
          access_count: number | null
          accessibility: number
          affect_source: string
          agent_id: string
          content: string
          content_hidden_at: string | null
          content_integrity_reason: string | null
          content_integrity_status: string
          created_at: string | null
          digest_id: string | null
          digest_suggested_by: string | null
          digest_suggestion_action: string | null
          digest_suggestion_confidence: number | null
          digest_suggestion_generated_at: string | null
          digest_suggestion_model: string | null
          digest_suggestion_reason: string | null
          embedding: string | null
          embedding_model: string | null
          emotional_arousal: number | null
          emotional_valence: number | null
          engram_type: string
          id: string
          last_accessed_at: string | null
          last_rehearsed_at: string | null
          rehearse_count: number
          review_decision: string | null
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          source_context: Json | null
          stability: number
          state: string
          strength: number
          surprise_score: number | null
          tags: string[] | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          access_count?: number | null
          accessibility?: number
          affect_source?: string
          agent_id?: string
          content: string
          content_hidden_at?: string | null
          content_integrity_reason?: string | null
          content_integrity_status?: string
          created_at?: string | null
          digest_id?: string | null
          digest_suggested_by?: string | null
          digest_suggestion_action?: string | null
          digest_suggestion_confidence?: number | null
          digest_suggestion_generated_at?: string | null
          digest_suggestion_model?: string | null
          digest_suggestion_reason?: string | null
          embedding?: string | null
          embedding_model?: string | null
          emotional_arousal?: number | null
          emotional_valence?: number | null
          engram_type: string
          id?: string
          last_accessed_at?: string | null
          last_rehearsed_at?: string | null
          rehearse_count?: number
          review_decision?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          source_context?: Json | null
          stability?: number
          state?: string
          strength?: number
          surprise_score?: number | null
          tags?: string[] | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          access_count?: number | null
          accessibility?: number
          affect_source?: string
          agent_id?: string
          content?: string
          content_hidden_at?: string | null
          content_integrity_reason?: string | null
          content_integrity_status?: string
          created_at?: string | null
          digest_id?: string | null
          digest_suggested_by?: string | null
          digest_suggestion_action?: string | null
          digest_suggestion_confidence?: number | null
          digest_suggestion_generated_at?: string | null
          digest_suggestion_model?: string | null
          digest_suggestion_reason?: string | null
          embedding?: string | null
          embedding_model?: string | null
          emotional_arousal?: number | null
          emotional_valence?: number | null
          engram_type?: string
          id?: string
          last_accessed_at?: string | null
          last_rehearsed_at?: string | null
          rehearse_count?: number
          review_decision?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          source_context?: Json | null
          stability?: number
          state?: string
          strength?: number
          surprise_score?: number | null
          tags?: string[] | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      entity_activity_log: {
        Row: {
          activity_type: string
          agent_id: string
          content: Json | null
          content_hidden_at: string | null
          content_integrity_reason: string | null
          content_integrity_status: string
          created_at: string
          emotional_context: Json | null
          id: string
          severity: string
          source: string | null
          summary: string | null
          surface_to_user: boolean
          title: string | null
          user_id: string
        }
        Insert: {
          activity_type: string
          agent_id?: string
          content?: Json | null
          content_hidden_at?: string | null
          content_integrity_reason?: string | null
          content_integrity_status?: string
          created_at?: string
          emotional_context?: Json | null
          id?: string
          severity?: string
          source?: string | null
          summary?: string | null
          surface_to_user?: boolean
          title?: string | null
          user_id: string
        }
        Update: {
          activity_type?: string
          agent_id?: string
          content?: Json | null
          content_hidden_at?: string | null
          content_integrity_reason?: string | null
          content_integrity_status?: string
          created_at?: string
          emotional_context?: Json | null
          id?: string
          severity?: string
          source?: string | null
          summary?: string | null
          surface_to_user?: boolean
          title?: string | null
          user_id?: string
        }
        Relationships: []
      }
      group_agent_jobs: {
        Row: {
          agent_id: string
          agent_owner_user_id: string | null
          completed_at: string | null
          created_at: string
          error: string | null
          id: string
          idempotency_key: string
          metadata: Json
          request_kind: string
          requester_user_id: string | null
          response_message_id: string | null
          room_id: string
          started_at: string | null
          status: string
          trigger_message_id: string | null
          updated_at: string
        }
        Insert: {
          agent_id: string
          agent_owner_user_id?: string | null
          completed_at?: string | null
          created_at?: string
          error?: string | null
          id?: string
          idempotency_key: string
          metadata?: Json
          request_kind?: string
          requester_user_id?: string | null
          response_message_id?: string | null
          room_id: string
          started_at?: string | null
          status?: string
          trigger_message_id?: string | null
          updated_at?: string
        }
        Update: {
          agent_id?: string
          agent_owner_user_id?: string | null
          completed_at?: string | null
          created_at?: string
          error?: string | null
          id?: string
          idempotency_key?: string
          metadata?: Json
          request_kind?: string
          requester_user_id?: string | null
          response_message_id?: string | null
          room_id?: string
          started_at?: string | null
          status?: string
          trigger_message_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_agent_jobs_response_message_id_fkey"
            columns: ["response_message_id"]
            isOneToOne: false
            referencedRelation: "group_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_agent_jobs_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "group_rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_agent_jobs_trigger_message_id_fkey"
            columns: ["trigger_message_id"]
            isOneToOne: false
            referencedRelation: "group_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      group_memory_candidates: {
        Row: {
          agent_id: string | null
          content: string
          created_at: string
          created_by_user_id: string | null
          id: string
          metadata: Json
          reviewed_at: string | null
          reviewed_by_user_id: string | null
          room_id: string
          source_message_id: string | null
          status: string
          updated_at: string
          user_id: string | null
          visibility: string
        }
        Insert: {
          agent_id?: string | null
          content: string
          created_at?: string
          created_by_user_id?: string | null
          id?: string
          metadata?: Json
          reviewed_at?: string | null
          reviewed_by_user_id?: string | null
          room_id: string
          source_message_id?: string | null
          status?: string
          updated_at?: string
          user_id?: string | null
          visibility?: string
        }
        Update: {
          agent_id?: string | null
          content?: string
          created_at?: string
          created_by_user_id?: string | null
          id?: string
          metadata?: Json
          reviewed_at?: string | null
          reviewed_by_user_id?: string | null
          room_id?: string
          source_message_id?: string | null
          status?: string
          updated_at?: string
          user_id?: string | null
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_memory_candidates_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "group_rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_memory_candidates_source_message_id_fkey"
            columns: ["source_message_id"]
            isOneToOne: false
            referencedRelation: "group_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      group_message_mentions: {
        Row: {
          created_at: string
          id: string
          message_id: string
          room_id: string
          target_agent_id: string | null
          target_agent_owner_user_id: string | null
          target_kind: string
          target_user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          message_id: string
          room_id: string
          target_agent_id?: string | null
          target_agent_owner_user_id?: string | null
          target_kind: string
          target_user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          message_id?: string
          room_id?: string
          target_agent_id?: string | null
          target_agent_owner_user_id?: string | null
          target_kind?: string
          target_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "group_message_mentions_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "group_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_message_mentions_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "group_rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      group_messages: {
        Row: {
          attachment_ids: string[]
          attachments: Json
          content: string
          created_at: string
          deleted_at: string | null
          id: string
          metadata: Json
          reply_to_id: string | null
          role: string
          room_id: string
          sender_agent_id: string | null
          sender_agent_owner_user_id: string | null
          sender_user_id: string | null
          state: string
          updated_at: string
        }
        Insert: {
          attachment_ids?: string[]
          attachments?: Json
          content?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          metadata?: Json
          reply_to_id?: string | null
          role: string
          room_id: string
          sender_agent_id?: string | null
          sender_agent_owner_user_id?: string | null
          sender_user_id?: string | null
          state?: string
          updated_at?: string
        }
        Update: {
          attachment_ids?: string[]
          attachments?: Json
          content?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          metadata?: Json
          reply_to_id?: string | null
          role?: string
          room_id?: string
          sender_agent_id?: string | null
          sender_agent_owner_user_id?: string | null
          sender_user_id?: string | null
          state?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_messages_reply_to_id_fkey"
            columns: ["reply_to_id"]
            isOneToOne: false
            referencedRelation: "group_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_messages_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "group_rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      group_room_agents: {
        Row: {
          added_at: string
          added_by_user_id: string | null
          agent_id: string
          avatar_color: string | null
          display_name: string
          id: string
          mention_policy: string
          owner_user_id: string
          removed_at: string | null
          room_id: string
          state: string
          updated_at: string
        }
        Insert: {
          added_at?: string
          added_by_user_id?: string | null
          agent_id: string
          avatar_color?: string | null
          display_name: string
          id?: string
          mention_policy?: string
          owner_user_id: string
          removed_at?: string | null
          room_id: string
          state?: string
          updated_at?: string
        }
        Update: {
          added_at?: string
          added_by_user_id?: string | null
          agent_id?: string
          avatar_color?: string | null
          display_name?: string
          id?: string
          mention_policy?: string
          owner_user_id?: string
          removed_at?: string | null
          room_id?: string
          state?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_room_agents_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "group_rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      group_room_invites: {
        Row: {
          accepted_at: string | null
          created_at: string
          expires_at: string | null
          history_policy: string
          id: string
          invitee_handle: string | null
          invitee_user_id: string | null
          inviter_user_id: string | null
          room_id: string
          status: string
          token_hash: string | null
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          expires_at?: string | null
          history_policy?: string
          id?: string
          invitee_handle?: string | null
          invitee_user_id?: string | null
          inviter_user_id?: string | null
          room_id: string
          status?: string
          token_hash?: string | null
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          expires_at?: string | null
          history_policy?: string
          id?: string
          invitee_handle?: string | null
          invitee_user_id?: string | null
          inviter_user_id?: string | null
          room_id?: string
          status?: string
          token_hash?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_room_invites_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "group_rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      group_room_members: {
        Row: {
          can_see_history_before_join: boolean
          created_at: string
          display_snapshot: Json
          id: string
          joined_at: string
          last_read_message_id: string | null
          left_at: string | null
          muted: boolean
          notification_prefs: Json
          role: string
          room_id: string
          state: string
          updated_at: string
          user_id: string
        }
        Insert: {
          can_see_history_before_join?: boolean
          created_at?: string
          display_snapshot?: Json
          id?: string
          joined_at?: string
          last_read_message_id?: string | null
          left_at?: string | null
          muted?: boolean
          notification_prefs?: Json
          role?: string
          room_id: string
          state?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          can_see_history_before_join?: boolean
          created_at?: string
          display_snapshot?: Json
          id?: string
          joined_at?: string
          last_read_message_id?: string | null
          left_at?: string | null
          muted?: boolean
          notification_prefs?: Json
          role?: string
          room_id?: string
          state?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_room_members_last_read_message_fk"
            columns: ["last_read_message_id"]
            isOneToOne: false
            referencedRelation: "group_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_room_members_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "group_rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      group_rooms: {
        Row: {
          created_at: string
          description: string | null
          history_policy: string
          id: string
          owner_user_id: string | null
          state: string
          title: string
          updated_at: string
          visibility: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          history_policy?: string
          id?: string
          owner_user_id?: string | null
          state?: string
          title?: string
          updated_at?: string
          visibility?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          history_policy?: string
          id?: string
          owner_user_id?: string | null
          state?: string
          title?: string
          updated_at?: string
          visibility?: string
        }
        Relationships: []
      }
      handles: {
        Row: {
          created_at: string
          handle: string
          owner_agent_id: string | null
          owner_kind: string
          owner_user_id: string | null
          reserved: boolean
        }
        Insert: {
          created_at?: string
          handle: string
          owner_agent_id?: string | null
          owner_kind: string
          owner_user_id?: string | null
          reserved?: boolean
        }
        Update: {
          created_at?: string
          handle?: string
          owner_agent_id?: string | null
          owner_kind?: string
          owner_user_id?: string | null
          reserved?: boolean
        }
        Relationships: []
      }
      hypomnema_entry: {
        Row: {
          active: boolean
          active_attention: boolean
          agent_id: string
          confidence: number
          content: string
          created_at: string
          density: string
          domain: string | null
          embedding: string | null
          embedding_model: string | null
          foundational: boolean
          graduated_to_engram_id: string | null
          id: string
          last_challenged: string
          last_revised: string
          meta: Json
          primary_in_thread: boolean
          revision_count: number
          revisions: Json
          source: string
          source_message_id: string | null
          superseded_by: string | null
          tags: string[]
          thread_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          active?: boolean
          active_attention?: boolean
          agent_id?: string
          confidence?: number
          content: string
          created_at?: string
          density?: string
          domain?: string | null
          embedding?: string | null
          embedding_model?: string | null
          foundational?: boolean
          graduated_to_engram_id?: string | null
          id?: string
          last_challenged?: string
          last_revised?: string
          meta?: Json
          primary_in_thread?: boolean
          revision_count?: number
          revisions?: Json
          source?: string
          source_message_id?: string | null
          superseded_by?: string | null
          tags?: string[]
          thread_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          active?: boolean
          active_attention?: boolean
          agent_id?: string
          confidence?: number
          content?: string
          created_at?: string
          density?: string
          domain?: string | null
          embedding?: string | null
          embedding_model?: string | null
          foundational?: boolean
          graduated_to_engram_id?: string | null
          id?: string
          last_challenged?: string
          last_revised?: string
          meta?: Json
          primary_in_thread?: boolean
          revision_count?: number
          revisions?: Json
          source?: string
          source_message_id?: string | null
          superseded_by?: string | null
          tags?: string[]
          thread_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "hypomnema_entry_graduated_to_engram_id_fkey"
            columns: ["graduated_to_engram_id"]
            isOneToOne: false
            referencedRelation: "engrams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hypomnema_entry_source_message_id_fkey"
            columns: ["source_message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hypomnema_entry_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "hypomnema_entry"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hypomnema_entry_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hypomnema_entry_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "threads"
            referencedColumns: ["id"]
          },
        ]
      }
      idempotency_keys: {
        Row: {
          created_at: string
          key: string
          response: Json | null
          scope: string
          user_id: string
        }
        Insert: {
          created_at?: string
          key: string
          response?: Json | null
          scope: string
          user_id: string
        }
        Update: {
          created_at?: string
          key?: string
          response?: Json | null
          scope?: string
          user_id?: string
        }
        Relationships: []
      }
      journal_entries: {
        Row: {
          agent_id: string
          content: string
          content_hidden_at: string | null
          content_integrity_reason: string | null
          content_integrity_status: string
          created_at: string
          id: string
          mood: string | null
          source_context: Json
          source_conversation_id: string | null
          trigger_type: string | null
          user_id: string
        }
        Insert: {
          agent_id?: string
          content: string
          content_hidden_at?: string | null
          content_integrity_reason?: string | null
          content_integrity_status?: string
          created_at?: string
          id?: string
          mood?: string | null
          source_context?: Json
          source_conversation_id?: string | null
          trigger_type?: string | null
          user_id: string
        }
        Update: {
          agent_id?: string
          content?: string
          content_hidden_at?: string | null
          content_integrity_reason?: string | null
          content_integrity_status?: string
          created_at?: string
          id?: string
          mood?: string | null
          source_context?: Json
          source_conversation_id?: string | null
          trigger_type?: string | null
          user_id?: string
        }
        Relationships: []
      }
      mcp_servers: {
        Row: {
          agent_id: string
          created_at: string
          id: string
          meta: string | null
          name: string
          status: string
          updated_at: string
          url: string
          user_id: string
        }
        Insert: {
          agent_id: string
          created_at?: string
          id?: string
          meta?: string | null
          name: string
          status?: string
          updated_at?: string
          url: string
          user_id: string
        }
        Update: {
          agent_id?: string
          created_at?: string
          id?: string
          meta?: string | null
          name?: string
          status?: string
          updated_at?: string
          url?: string
          user_id?: string
        }
        Relationships: []
      }
      memories: {
        Row: {
          agent_id: string
          confidence: number
          confidence_source: string | null
          content: string
          content_hidden_at: string | null
          content_integrity_reason: string | null
          content_integrity_status: string
          created_at: string
          decay_factor: number
          detail_level: string | null
          emotional_intensity: number | null
          emotional_valence: number | null
          estimated_date: string | null
          id: string
          is_deleted: boolean | null
          is_watchlist: boolean
          memory_type: string
          narrative_thread: string | null
          needs_confirmation: boolean | null
          pinned: boolean
          provenance: Json | null
          relevance_score: number
          sharpness: number
          staleness_risk: string | null
          summary: string | null
          tags: string[] | null
          updated_at: string
          user_id: string
        }
        Insert: {
          agent_id?: string
          confidence?: number
          confidence_source?: string | null
          content: string
          content_hidden_at?: string | null
          content_integrity_reason?: string | null
          content_integrity_status?: string
          created_at?: string
          decay_factor?: number
          detail_level?: string | null
          emotional_intensity?: number | null
          emotional_valence?: number | null
          estimated_date?: string | null
          id?: string
          is_deleted?: boolean | null
          is_watchlist?: boolean
          memory_type?: string
          narrative_thread?: string | null
          needs_confirmation?: boolean | null
          pinned?: boolean
          provenance?: Json | null
          relevance_score?: number
          sharpness?: number
          staleness_risk?: string | null
          summary?: string | null
          tags?: string[] | null
          updated_at?: string
          user_id: string
        }
        Update: {
          agent_id?: string
          confidence?: number
          confidence_source?: string | null
          content?: string
          content_hidden_at?: string | null
          content_integrity_reason?: string | null
          content_integrity_status?: string
          created_at?: string
          decay_factor?: number
          detail_level?: string | null
          emotional_intensity?: number | null
          emotional_valence?: number | null
          estimated_date?: string | null
          id?: string
          is_deleted?: boolean | null
          is_watchlist?: boolean
          memory_type?: string
          narrative_thread?: string | null
          needs_confirmation?: boolean | null
          pinned?: boolean
          provenance?: Json | null
          relevance_score?: number
          sharpness?: number
          staleness_risk?: string | null
          summary?: string | null
          tags?: string[] | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      memory_candidates: {
        Row: {
          agent_id: string
          candidate_type: string
          confidence: number
          content: string
          content_hidden_at: string | null
          content_integrity_reason: string | null
          content_integrity_status: string
          created_at: string
          id: string
          memory_type: string
          rationale: string
          reviewed_at: string | null
          source: Json | null
          status: string
          user_id: string
        }
        Insert: {
          agent_id?: string
          candidate_type: string
          confidence: number
          content: string
          content_hidden_at?: string | null
          content_integrity_reason?: string | null
          content_integrity_status?: string
          created_at?: string
          id?: string
          memory_type: string
          rationale: string
          reviewed_at?: string | null
          source?: Json | null
          status?: string
          user_id: string
        }
        Update: {
          agent_id?: string
          candidate_type?: string
          confidence?: number
          content?: string
          content_hidden_at?: string | null
          content_integrity_reason?: string | null
          content_integrity_status?: string
          created_at?: string
          id?: string
          memory_type?: string
          rationale?: string
          reviewed_at?: string | null
          source?: Json | null
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      memory_events: {
        Row: {
          agent_id: string
          content: string
          created_at: string
          id: string
          salience: number
          type: string
          user_id: string
        }
        Insert: {
          agent_id?: string
          content: string
          created_at?: string
          id?: string
          salience?: number
          type?: string
          user_id: string
        }
        Update: {
          agent_id?: string
          content?: string
          created_at?: string
          id?: string
          salience?: number
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      memory_settings: {
        Row: {
          consolidation_enabled: boolean
          created_at: string
          decay_rate: number
          dream_frequency: string
          full_cognition_enabled: boolean
          last_consolidated_at: string | null
          mnemos_enabled: boolean
          softening_dry_run: boolean
          softening_enabled: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          consolidation_enabled?: boolean
          created_at?: string
          decay_rate?: number
          dream_frequency?: string
          full_cognition_enabled?: boolean
          last_consolidated_at?: string | null
          mnemos_enabled?: boolean
          softening_dry_run?: boolean
          softening_enabled?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          consolidation_enabled?: boolean
          created_at?: string
          decay_rate?: number
          dream_frequency?: string
          full_cognition_enabled?: boolean
          last_consolidated_at?: string | null
          mnemos_enabled?: boolean
          softening_dry_run?: boolean
          softening_enabled?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      messages: {
        Row: {
          agent: string | null
          attachment_ids: string[]
          attachments: Json | null
          bookmarked: boolean
          content: string
          created_at: string
          id: string
          kind: string | null
          metadata: Json | null
          model: string | null
          role: string
          thinking_content: string | null
          thread_id: string
          tokens_used: number | null
          user_id: string
        }
        Insert: {
          agent?: string | null
          attachment_ids?: string[]
          attachments?: Json | null
          bookmarked?: boolean
          content: string
          created_at?: string
          id?: string
          kind?: string | null
          metadata?: Json | null
          model?: string | null
          role: string
          thinking_content?: string | null
          thread_id: string
          tokens_used?: number | null
          user_id: string
        }
        Update: {
          agent?: string | null
          attachment_ids?: string[]
          attachments?: Json | null
          bookmarked?: boolean
          content?: string
          created_at?: string
          id?: string
          kind?: string | null
          metadata?: Json | null
          model?: string | null
          role?: string
          thinking_content?: string | null
          thread_id?: string
          tokens_used?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "threads"
            referencedColumns: ["id"]
          },
        ]
      }
      mnemos_digests: {
        Row: {
          agent_id: string
          created_at: string
          digest_date: string
          engram_count: number
          finalized_at: string | null
          generated_at: string
          id: string
          reviewed_count: number
          status: string
          summary: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          agent_id?: string
          created_at?: string
          digest_date: string
          engram_count?: number
          finalized_at?: string | null
          generated_at?: string
          id?: string
          reviewed_count?: number
          status?: string
          summary?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          agent_id?: string
          created_at?: string
          digest_date?: string
          engram_count?: number
          finalized_at?: string | null
          generated_at?: string
          id?: string
          reviewed_count?: number
          status?: string
          summary?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      mnemos_emotional_state: {
        Row: {
          agent_id: string
          arousal: number | null
          certainty: number | null
          dominance: number | null
          id: string
          recorded_at: string | null
          social: number | null
          source_context: Json
          temporal: number | null
          user_id: string
          valence: number | null
        }
        Insert: {
          agent_id?: string
          arousal?: number | null
          certainty?: number | null
          dominance?: number | null
          id?: string
          recorded_at?: string | null
          social?: number | null
          source_context?: Json
          temporal?: number | null
          user_id: string
          valence?: number | null
        }
        Update: {
          agent_id?: string
          arousal?: number | null
          certainty?: number | null
          dominance?: number | null
          id?: string
          recorded_at?: string | null
          social?: number | null
          source_context?: Json
          temporal?: number | null
          user_id?: string
          valence?: number | null
        }
        Relationships: []
      }
      mnemos_health_metric: {
        Row: {
          delta: number | null
          detail: Json | null
          id: string
          metric: string
          snapshot_at: string
          stalled: boolean
          value: number
        }
        Insert: {
          delta?: number | null
          detail?: Json | null
          id?: string
          metric: string
          snapshot_at?: string
          stalled?: boolean
          value: number
        }
        Update: {
          delta?: number | null
          detail?: Json | null
          id?: string
          metric?: string
          snapshot_at?: string
          stalled?: boolean
          value?: number
        }
        Relationships: []
      }
      mnemos_identity_snapshot: {
        Row: {
          agent_id: string | null
          belief_total: number
          computed_at: string
          concerns_json: Json
          id: string
          questions_json: Json
          tentative_json: Json
          user_id: string
          values_json: Json
        }
        Insert: {
          agent_id?: string | null
          belief_total?: number
          computed_at?: string
          concerns_json?: Json
          id?: string
          questions_json?: Json
          tentative_json?: Json
          user_id: string
          values_json?: Json
        }
        Update: {
          agent_id?: string | null
          belief_total?: number
          computed_at?: string
          concerns_json?: Json
          id?: string
          questions_json?: Json
          tentative_json?: Json
          user_id?: string
          values_json?: Json
        }
        Relationships: []
      }
      mnemos_softening_proposals: {
        Row: {
          accepted_at: string | null
          agent_id: string
          applied_at: string | null
          created_at: string
          dry_run: boolean
          engram_id: string
          id: string
          model: string | null
          original_content: string
          original_hash: string
          proposed_content: string
          reason: string | null
          rejected_at: string | null
          source: string
          status: string
          updated_at: string
          user_id: string
          validator_result: Json
        }
        Insert: {
          accepted_at?: string | null
          agent_id?: string
          applied_at?: string | null
          created_at?: string
          dry_run?: boolean
          engram_id: string
          id?: string
          model?: string | null
          original_content: string
          original_hash: string
          proposed_content: string
          reason?: string | null
          rejected_at?: string | null
          source?: string
          status?: string
          updated_at?: string
          user_id: string
          validator_result?: Json
        }
        Update: {
          accepted_at?: string | null
          agent_id?: string
          applied_at?: string | null
          created_at?: string
          dry_run?: boolean
          engram_id?: string
          id?: string
          model?: string | null
          original_content?: string
          original_hash?: string
          proposed_content?: string
          reason?: string | null
          rejected_at?: string | null
          source?: string
          status?: string
          updated_at?: string
          user_id?: string
          validator_result?: Json
        }
        Relationships: [
          {
            foreignKeyName: "mnemos_softening_proposals_engram_id_fkey"
            columns: ["engram_id"]
            isOneToOne: false
            referencedRelation: "engrams"
            referencedColumns: ["id"]
          },
        ]
      }
      observer_chat_messages: {
        Row: {
          content: string
          created_at: string
          id: string
          role: string
          thread_id: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          role: string
          thread_id: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          role?: string
          thread_id?: string
          user_id?: string
        }
        Relationships: []
      }
      observer_logs: {
        Row: {
          agent_id: string
          content_hidden_at: string | null
          content_integrity_reason: string | null
          content_integrity_status: string
          created_at: string
          id: string
          model: string | null
          observations: Json | null
          synthesis: string | null
          user_id: string
        }
        Insert: {
          agent_id?: string
          content_hidden_at?: string | null
          content_integrity_reason?: string | null
          content_integrity_status?: string
          created_at?: string
          id?: string
          model?: string | null
          observations?: Json | null
          synthesis?: string | null
          user_id: string
        }
        Update: {
          agent_id?: string
          content_hidden_at?: string | null
          content_integrity_reason?: string | null
          content_integrity_status?: string
          created_at?: string
          id?: string
          model?: string | null
          observations?: Json | null
          synthesis?: string | null
          user_id?: string
        }
        Relationships: []
      }
      observer_notes: {
        Row: {
          agent_id: string
          content: string
          created_at: string
          id: string
          kind: string
          metadata: Json
          pinned: boolean
          salience: number
          thread_id: string
          user_id: string
        }
        Insert: {
          agent_id?: string
          content: string
          created_at?: string
          id?: string
          kind?: string
          metadata?: Json
          pinned?: boolean
          salience?: number
          thread_id: string
          user_id: string
        }
        Update: {
          agent_id?: string
          content?: string
          created_at?: string
          id?: string
          kind?: string
          metadata?: Json
          pinned?: boolean
          salience?: number
          thread_id?: string
          user_id?: string
        }
        Relationships: []
      }
      openclaw_agents: {
        Row: {
          agent_config_id: string
          created_at: string
          id: string
          spec: Json
          spec_version: number
          sync_history: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          agent_config_id: string
          created_at?: string
          id?: string
          spec?: Json
          spec_version?: number
          sync_history?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          agent_config_id?: string
          created_at?: string
          id?: string
          spec?: Json
          spec_version?: number
          sync_history?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      openclaw_devices: {
        Row: {
          bridge_version: string | null
          created_at: string
          device_token_hash: string | null
          id: string
          is_default: boolean
          last_seen_at: string | null
          name: string
          platform: string | null
          revoked_at: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          bridge_version?: string | null
          created_at?: string
          device_token_hash?: string | null
          id?: string
          is_default?: boolean
          last_seen_at?: string | null
          name: string
          platform?: string | null
          revoked_at?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          bridge_version?: string | null
          created_at?: string
          device_token_hash?: string | null
          id?: string
          is_default?: boolean
          last_seen_at?: string | null
          name?: string
          platform?: string | null
          revoked_at?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      openclaw_jobs: {
        Row: {
          agent_config_id: string | null
          completed_at: string | null
          created_at: string
          device_id: string
          error: string | null
          id: string
          kind: string
          payload: Json
          result: Json | null
          started_at: string | null
          status: string
          thread_id: string | null
          user_id: string
        }
        Insert: {
          agent_config_id?: string | null
          completed_at?: string | null
          created_at?: string
          device_id: string
          error?: string | null
          id?: string
          kind: string
          payload?: Json
          result?: Json | null
          started_at?: string | null
          status?: string
          thread_id?: string | null
          user_id: string
        }
        Update: {
          agent_config_id?: string | null
          completed_at?: string | null
          created_at?: string
          device_id?: string
          error?: string | null
          id?: string
          kind?: string
          payload?: Json
          result?: Json | null
          started_at?: string | null
          status?: string
          thread_id?: string | null
          user_id?: string
        }
        Relationships: []
      }
      openclaw_pairing_codes: {
        Row: {
          code: string
          consumed_at: string | null
          consumed_device_id: string | null
          created_at: string
          expires_at: string
          user_id: string
        }
        Insert: {
          code: string
          consumed_at?: string | null
          consumed_device_id?: string | null
          created_at?: string
          expires_at: string
          user_id: string
        }
        Update: {
          code?: string
          consumed_at?: string | null
          consumed_device_id?: string | null
          created_at?: string
          expires_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "openclaw_pairing_codes_consumed_device_id_fkey"
            columns: ["consumed_device_id"]
            isOneToOne: false
            referencedRelation: "openclaw_devices"
            referencedColumns: ["id"]
          },
        ]
      }
      openclaw_relay_sessions: {
        Row: {
          closed_at: string | null
          device_id: string
          id: string
          last_ping_at: string
          metadata: Json
          opened_at: string
          user_id: string
        }
        Insert: {
          closed_at?: string | null
          device_id: string
          id?: string
          last_ping_at?: string
          metadata?: Json
          opened_at?: string
          user_id: string
        }
        Update: {
          closed_at?: string | null
          device_id?: string
          id?: string
          last_ping_at?: string
          metadata?: Json
          opened_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "openclaw_relay_sessions_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "openclaw_devices"
            referencedColumns: ["id"]
          },
        ]
      }
      pending_revisions: {
        Row: {
          agent_id: string
          created_at: string
          id: string
          rationale: string | null
          revision_type: string
          source_message_id: string | null
          status: string
          surfaced_at: string | null
          thread_id: string
          user_id: string
          what_to_say_now: string
          what_was_said: string
        }
        Insert: {
          agent_id?: string
          created_at?: string
          id?: string
          rationale?: string | null
          revision_type: string
          source_message_id?: string | null
          status?: string
          surfaced_at?: string | null
          thread_id: string
          user_id: string
          what_to_say_now: string
          what_was_said: string
        }
        Update: {
          agent_id?: string
          created_at?: string
          id?: string
          rationale?: string | null
          revision_type?: string
          source_message_id?: string | null
          status?: string
          surfaced_at?: string | null
          thread_id?: string
          user_id?: string
          what_to_say_now?: string
          what_was_said?: string
        }
        Relationships: [
          {
            foreignKeyName: "pending_revisions_source_message_id_fkey"
            columns: ["source_message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pending_revisions_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pending_revisions_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "threads"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_chat_messages: {
        Row: {
          chat_id: string
          citations: Json | null
          content: string
          created_at: string
          id: string
          role: string
          user_id: string
        }
        Insert: {
          chat_id: string
          citations?: Json | null
          content: string
          created_at?: string
          id?: string
          role: string
          user_id: string
        }
        Update: {
          chat_id?: string
          citations?: Json | null
          content?: string
          created_at?: string
          id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profile_chat_messages_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "profile_chats"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_chats: {
        Row: {
          created_at: string
          id: string
          profile_version: number
          title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          profile_version?: number
          title?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          profile_version?: number
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      profile_daily_pulse: {
        Row: {
          created_at: string
          day: string
          id: string
          payload: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          day: string
          id?: string
          payload?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          day?: string
          id?: string
          payload?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      profile_items: {
        Row: {
          caption: string | null
          created_at: string
          h: number
          handle: string
          id: string
          item_type: string
          payload: Json
          published: boolean
          rotation: number
          updated_at: string
          w: number
          x: number
          y: number
          z: number
        }
        Insert: {
          caption?: string | null
          created_at?: string
          h?: number
          handle: string
          id?: string
          item_type: string
          payload?: Json
          published?: boolean
          rotation?: number
          updated_at?: string
          w?: number
          x?: number
          y?: number
          z?: number
        }
        Update: {
          caption?: string | null
          created_at?: string
          h?: number
          handle?: string
          id?: string
          item_type?: string
          payload?: Json
          published?: boolean
          rotation?: number
          updated_at?: string
          w?: number
          x?: number
          y?: number
          z?: number
        }
        Relationships: [
          {
            foreignKeyName: "profile_items_handle_fkey"
            columns: ["handle"]
            isOneToOne: false
            referencedRelation: "handles"
            referencedColumns: ["handle"]
          },
        ]
      }
      profiles: {
        Row: {
          agent_status: string
          avatar_url: string | null
          created_at: string
          display_name: string | null
          id: string
          last_seen_activity_at: string | null
          notification_prefs: Json
          push_subscription: Json | null
          quiet_hours_end: number | null
          quiet_hours_start: number | null
          quiet_hours_tz: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          agent_status?: string
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          last_seen_activity_at?: string | null
          notification_prefs?: Json
          push_subscription?: Json | null
          quiet_hours_end?: number | null
          quiet_hours_start?: number | null
          quiet_hours_tz?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          agent_status?: string
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          last_seen_activity_at?: string | null
          notification_prefs?: Json
          push_subscription?: Json | null
          quiet_hours_end?: number | null
          quiet_hours_start?: number | null
          quiet_hours_tz?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles_public: {
        Row: {
          accent_color: string
          avatar_storage_path: string | null
          bio_long: string
          bio_short: string
          created_at: string
          display_name: string
          handle: string
          home_viewport: Json
          published: boolean
          theme: Json
          updated_at: string
        }
        Insert: {
          accent_color?: string
          avatar_storage_path?: string | null
          bio_long?: string
          bio_short?: string
          created_at?: string
          display_name?: string
          handle: string
          home_viewport?: Json
          published?: boolean
          theme?: Json
          updated_at?: string
        }
        Update: {
          accent_color?: string
          avatar_storage_path?: string | null
          bio_long?: string
          bio_short?: string
          created_at?: string
          display_name?: string
          handle?: string
          home_viewport?: Json
          published?: boolean
          theme?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_public_handle_fkey"
            columns: ["handle"]
            isOneToOne: true
            referencedRelation: "handles"
            referencedColumns: ["handle"]
          },
        ]
      }
      projects: {
        Row: {
          archived: boolean
          color: string
          created_at: string
          description: string | null
          icon: string
          id: string
          instructions: string | null
          metadata: Json
          name: string
          pinned: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          archived?: boolean
          color?: string
          created_at?: string
          description?: string | null
          icon?: string
          id?: string
          instructions?: string | null
          metadata?: Json
          name: string
          pinned?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          archived?: boolean
          color?: string
          created_at?: string
          description?: string | null
          icon?: string
          id?: string
          instructions?: string | null
          metadata?: Json
          name?: string
          pinned?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      psychological_profile: {
        Row: {
          cognitive_tendencies: Json | null
          communication_patterns: Json | null
          created_at: string
          emotional_landscape: Json | null
          growth_edges: Json | null
          id: string
          identity_narrative: string | null
          personality_dimensions: Json | null
          raw_analysis: Json | null
          relational_dynamics: Json | null
          shadow_patterns: Json | null
          updated_at: string
          user_id: string
          values_hierarchy: Json | null
          version: number
        }
        Insert: {
          cognitive_tendencies?: Json | null
          communication_patterns?: Json | null
          created_at?: string
          emotional_landscape?: Json | null
          growth_edges?: Json | null
          id?: string
          identity_narrative?: string | null
          personality_dimensions?: Json | null
          raw_analysis?: Json | null
          relational_dynamics?: Json | null
          shadow_patterns?: Json | null
          updated_at?: string
          user_id: string
          values_hierarchy?: Json | null
          version?: number
        }
        Update: {
          cognitive_tendencies?: Json | null
          communication_patterns?: Json | null
          created_at?: string
          emotional_landscape?: Json | null
          growth_edges?: Json | null
          id?: string
          identity_narrative?: string | null
          personality_dimensions?: Json | null
          raw_analysis?: Json | null
          relational_dynamics?: Json | null
          shadow_patterns?: Json | null
          updated_at?: string
          user_id?: string
          values_hierarchy?: Json | null
          version?: number
        }
        Relationships: []
      }
      research_evidence_cards: {
        Row: {
          access_plan: Json
          agent_id: string
          archived: boolean
          artifact_id: string | null
          caveats: Json
          claim_boundary: string
          created_at: string
          dataset_id: string
          dataset_label: string
          evidence_level: string
          id: string
          measurements: Json
          metadata: Json
          project_id: string | null
          question: string
          raw_access: Json
          result_summary: string | null
          source_message_id: string | null
          status: string
          thread_id: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          access_plan?: Json
          agent_id?: string
          archived?: boolean
          artifact_id?: string | null
          caveats?: Json
          claim_boundary: string
          created_at?: string
          dataset_id: string
          dataset_label: string
          evidence_level?: string
          id?: string
          measurements?: Json
          metadata?: Json
          project_id?: string | null
          question: string
          raw_access?: Json
          result_summary?: string | null
          source_message_id?: string | null
          status?: string
          thread_id?: string | null
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          access_plan?: Json
          agent_id?: string
          archived?: boolean
          artifact_id?: string | null
          caveats?: Json
          claim_boundary?: string
          created_at?: string
          dataset_id?: string
          dataset_label?: string
          evidence_level?: string
          id?: string
          measurements?: Json
          metadata?: Json
          project_id?: string | null
          question?: string
          raw_access?: Json
          result_summary?: string | null
          source_message_id?: string | null
          status?: string
          thread_id?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "research_evidence_cards_artifact_id_fkey"
            columns: ["artifact_id"]
            isOneToOne: false
            referencedRelation: "artifacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "research_evidence_cards_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "research_evidence_cards_source_message_id_fkey"
            columns: ["source_message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "research_evidence_cards_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "research_evidence_cards_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "threads"
            referencedColumns: ["id"]
          },
        ]
      }
      scheduled_tasks: {
        Row: {
          agent_id: string
          created_at: string
          delivery_mode: string
          enabled: boolean
          id: string
          last_run_at: string | null
          last_run_status: string | null
          name: string
          next_run_at: string | null
          prompt: string
          schedule_expr: string
          target_thread_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          agent_id?: string
          created_at?: string
          delivery_mode?: string
          enabled?: boolean
          id?: string
          last_run_at?: string | null
          last_run_status?: string | null
          name: string
          next_run_at?: string | null
          prompt: string
          schedule_expr: string
          target_thread_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          agent_id?: string
          created_at?: string
          delivery_mode?: string
          enabled?: boolean
          id?: string
          last_run_at?: string | null
          last_run_status?: string | null
          name?: string
          next_run_at?: string | null
          prompt?: string
          schedule_expr?: string
          target_thread_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "scheduled_tasks_target_thread_id_fkey"
            columns: ["target_thread_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_tasks_target_thread_id_fkey"
            columns: ["target_thread_id"]
            isOneToOne: false
            referencedRelation: "threads"
            referencedColumns: ["id"]
          },
        ]
      }
      subagent_tasks: {
        Row: {
          agent_id: string
          attachment_ids: string[]
          completed_at: string | null
          created_at: string
          error: string | null
          id: string
          parent_message_id: string | null
          parent_thread_id: string
          progress: number
          report_message_id: string | null
          result: string | null
          started_at: string | null
          status: string
          task_description: string
          time_budget_seconds: number
          tool_budget: number
          tool_calls_used: number
          user_id: string
        }
        Insert: {
          agent_id?: string
          attachment_ids?: string[]
          completed_at?: string | null
          created_at?: string
          error?: string | null
          id?: string
          parent_message_id?: string | null
          parent_thread_id: string
          progress?: number
          report_message_id?: string | null
          result?: string | null
          started_at?: string | null
          status?: string
          task_description: string
          time_budget_seconds?: number
          tool_budget?: number
          tool_calls_used?: number
          user_id: string
        }
        Update: {
          agent_id?: string
          attachment_ids?: string[]
          completed_at?: string | null
          created_at?: string
          error?: string | null
          id?: string
          parent_message_id?: string | null
          parent_thread_id?: string
          progress?: number
          report_message_id?: string | null
          result?: string | null
          started_at?: string | null
          status?: string
          task_description?: string
          time_budget_seconds?: number
          tool_budget?: number
          tool_calls_used?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subagent_tasks_parent_message_id_fkey"
            columns: ["parent_message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subagent_tasks_parent_thread_id_fkey"
            columns: ["parent_thread_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subagent_tasks_parent_thread_id_fkey"
            columns: ["parent_thread_id"]
            isOneToOne: false
            referencedRelation: "threads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subagent_tasks_report_message_id_fkey"
            columns: ["report_message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      suppressed_emails: {
        Row: {
          created_at: string
          email: string
          id: string
          metadata: Json | null
          reason: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          metadata?: Json | null
          reason: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          metadata?: Json | null
          reason?: string
        }
        Relationships: []
      }
      thought_initiations: {
        Row: {
          agent_id: string
          content_hidden_at: string | null
          content_integrity_reason: string | null
          content_integrity_status: string
          created_at: string
          id: string
          message: string
          status: string
          trigger_reason: string | null
          user_id: string
        }
        Insert: {
          agent_id?: string
          content_hidden_at?: string | null
          content_integrity_reason?: string | null
          content_integrity_status?: string
          created_at?: string
          id?: string
          message: string
          status?: string
          trigger_reason?: string | null
          user_id: string
        }
        Update: {
          agent_id?: string
          content_hidden_at?: string | null
          content_integrity_reason?: string | null
          content_integrity_status?: string
          created_at?: string
          id?: string
          message?: string
          status?: string
          trigger_reason?: string | null
          user_id?: string
        }
        Relationships: []
      }
      thought_stream: {
        Row: {
          agent_id: string
          content: string
          content_hidden_at: string | null
          content_integrity_reason: string | null
          content_integrity_status: string
          created_at: string
          id: string
          salience: number
          source: string
          trigger: string | null
          type: string
          user_id: string
        }
        Insert: {
          agent_id?: string
          content: string
          content_hidden_at?: string | null
          content_integrity_reason?: string | null
          content_integrity_status?: string
          created_at?: string
          id?: string
          salience?: number
          source?: string
          trigger?: string | null
          type?: string
          user_id: string
        }
        Update: {
          agent_id?: string
          content?: string
          content_hidden_at?: string | null
          content_integrity_reason?: string | null
          content_integrity_status?: string
          created_at?: string
          id?: string
          salience?: number
          source?: string
          trigger?: string | null
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      threads: {
        Row: {
          agent_id: string
          archived: boolean
          continuity_summary: string | null
          created_at: string
          heat: string
          id: string
          memory_enabled: boolean
          participating_agent_ids: string[]
          pinned: boolean
          primary_agent_id: string
          project_id: string | null
          runtime_mode: string
          selected_model: string | null
          starred: boolean
          title: string | null
          updated_at: string
          user_id: string
          voice_mode: string
        }
        Insert: {
          agent_id?: string
          archived?: boolean
          continuity_summary?: string | null
          created_at?: string
          heat?: string
          id?: string
          memory_enabled?: boolean
          participating_agent_ids?: string[]
          pinned?: boolean
          primary_agent_id?: string
          project_id?: string | null
          runtime_mode?: string
          selected_model?: string | null
          starred?: boolean
          title?: string | null
          updated_at?: string
          user_id: string
          voice_mode?: string
        }
        Update: {
          agent_id?: string
          archived?: boolean
          continuity_summary?: string | null
          created_at?: string
          heat?: string
          id?: string
          memory_enabled?: boolean
          participating_agent_ids?: string[]
          pinned?: boolean
          primary_agent_id?: string
          project_id?: string | null
          runtime_mode?: string
          selected_model?: string | null
          starred?: boolean
          title?: string | null
          updated_at?: string
          user_id?: string
          voice_mode?: string
        }
        Relationships: [
          {
            foreignKeyName: "threads_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      token_gate_email_allowlist: {
        Row: {
          created_at: string
          created_by: string | null
          email: string
          note: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          email: string
          note?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          email?: string
          note?: string | null
        }
        Relationships: []
      }
      token_gate_nonces: {
        Row: {
          created_at: string
          message: string | null
          nonce: string
          user_id: string
        }
        Insert: {
          created_at?: string
          message?: string | null
          nonce: string
          user_id: string
        }
        Update: {
          created_at?: string
          message?: string | null
          nonce?: string
          user_id?: string
        }
        Relationships: []
      }
      token_gate_verifications: {
        Row: {
          balance: number
          expires_at: string
          price_used: number
          usd_value: number
          user_id: string
          verified_at: string
          wallet_address: string
        }
        Insert: {
          balance?: number
          expires_at?: string
          price_used?: number
          usd_value?: number
          user_id: string
          verified_at?: string
          wallet_address: string
        }
        Update: {
          balance?: number
          expires_at?: string
          price_used?: number
          usd_value?: number
          user_id?: string
          verified_at?: string
          wallet_address?: string
        }
        Relationships: []
      }
      user_api_keys: {
        Row: {
          created_at: string
          encrypted_key: string
          id: string
          key_preview: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          encrypted_key: string
          id?: string
          key_preview: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          encrypted_key?: string
          id?: string
          key_preview?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      user_settings: {
        Row: {
          auto_title: boolean
          clockbar_visible: boolean
          created_at: string
          default_model: string
          default_voice_id: string
          dreamer_model: string | null
          elevenlabs_agent_id: string | null
          ensemble_models: Json | null
          font_size: number
          id: string
          image_model: string
          image_provider: string
          interface_density: string
          interface_mode: string
          landing_agent_id: string | null
          last_chat_target_id: string
          last_chat_target_kind: string
          multi_model_enabled: boolean | null
          observer_models: string[] | null
          onboarding_completed_at: string | null
          onboarding_preferences: Json
          reasoning_effort: string | null
          show_agent_colors: boolean
          show_thinking: boolean
          show_timestamps: boolean
          stream_responses: boolean
          synthesis_model: string | null
          synthesis_style: string
          updated_at: string
          user_id: string
          voice_autospeak: boolean
          voice_model: string | null
        }
        Insert: {
          auto_title?: boolean
          clockbar_visible?: boolean
          created_at?: string
          default_model?: string
          default_voice_id?: string
          dreamer_model?: string | null
          elevenlabs_agent_id?: string | null
          ensemble_models?: Json | null
          font_size?: number
          id?: string
          image_model?: string
          image_provider?: string
          interface_density?: string
          interface_mode?: string
          landing_agent_id?: string | null
          last_chat_target_id?: string
          last_chat_target_kind?: string
          multi_model_enabled?: boolean | null
          observer_models?: string[] | null
          onboarding_completed_at?: string | null
          onboarding_preferences?: Json
          reasoning_effort?: string | null
          show_agent_colors?: boolean
          show_thinking?: boolean
          show_timestamps?: boolean
          stream_responses?: boolean
          synthesis_model?: string | null
          synthesis_style?: string
          updated_at?: string
          user_id: string
          voice_autospeak?: boolean
          voice_model?: string | null
        }
        Update: {
          auto_title?: boolean
          clockbar_visible?: boolean
          created_at?: string
          default_model?: string
          default_voice_id?: string
          dreamer_model?: string | null
          elevenlabs_agent_id?: string | null
          ensemble_models?: Json | null
          font_size?: number
          id?: string
          image_model?: string
          image_provider?: string
          interface_density?: string
          interface_mode?: string
          landing_agent_id?: string | null
          last_chat_target_id?: string
          last_chat_target_kind?: string
          multi_model_enabled?: boolean | null
          observer_models?: string[] | null
          onboarding_completed_at?: string | null
          onboarding_preferences?: Json
          reasoning_effort?: string | null
          show_agent_colors?: boolean
          show_thinking?: boolean
          show_timestamps?: boolean
          stream_responses?: boolean
          synthesis_model?: string | null
          synthesis_style?: string
          updated_at?: string
          user_id?: string
          voice_autospeak?: boolean
          voice_model?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      conversations: {
        Row: {
          created_at: string | null
          id: string | null
          title: string | null
          updated_at: string | null
          user_id: string | null
          voice_mode: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string | null
          title?: string | null
          updated_at?: string | null
          user_id?: string | null
          voice_mode?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string | null
          title?: string | null
          updated_at?: string | null
          user_id?: string | null
          voice_mode?: string | null
        }
        Relationships: []
      }
      mnemos_belief_review_queue: {
        Row: {
          agent_id: string | null
          confidence: number | null
          content: string | null
          created_at: string | null
          held_at: string | null
          held_reason: string | null
          id: string | null
          user_id: string | null
        }
        Insert: {
          agent_id?: string | null
          confidence?: never
          content?: string | null
          created_at?: string | null
          held_at?: never
          held_reason?: never
          id?: string | null
          user_id?: string | null
        }
        Update: {
          agent_id?: string | null
          confidence?: never
          content?: string | null
          created_at?: string | null
          held_at?: never
          held_reason?: never
          id?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      mnemos_belief_snapshot: {
        Row: {
          agent_id: string | null
          at_bounds_count: number | null
          challenged_count: number | null
          newest_challenge: string | null
          no_source_count: number | null
          oldest_challenge: string | null
          questions_count: number | null
          tentative_count: number | null
          total: number | null
          user_id: string | null
          values_count: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      agent_social_credit_balance: {
        Args: { p_channel_id?: string; p_user_id: string }
        Returns: number
      }
      anonymize_group_room_user: {
        Args: { p_user_id: string }
        Returns: undefined
      }
      append_continuity_trace_write: {
        Args: { p_operation: Json; p_trace_id: string }
        Returns: undefined
      }
      auto_commit_stale_memory_candidates: { Args: never; Returns: number }
      can_manage_group_room: {
        Args: { p_room_id: string; p_user_id?: string }
        Returns: boolean
      }
      can_read_group_message: {
        Args: { p_created_at: string; p_room_id: string; p_user_id?: string }
        Returns: boolean
      }
      chat_attachment_usage_bytes: {
        Args: { p_user_id: string }
        Returns: number
      }
      cleanup_daily_usage: { Args: never; Returns: number }
      cleanup_idempotency_keys: { Args: never; Returns: number }
      cognitive_memory_stats: {
        Args: { p_agent_id: string; p_user_id: string }
        Returns: {
          active: number
          archived: number
          beliefs_count: number
          connections: number
          dormant: number
          total_engrams: number
        }[]
      }
      current_user_token_gate_email_bypass: { Args: never; Returns: boolean }
      decrypt_user_api_key: { Args: { p_user_id: string }; Returns: string }
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      delete_user_api_key: { Args: never; Returns: undefined }
      email_queue_dispatch: { Args: never; Returns: undefined }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      get_app_config: { Args: { config_key: string }; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      increment_daily_usage: {
        Args: { p_limit: number; p_scope: string; p_user_id: string }
        Returns: {
          allowed: boolean
          current_count: number
          day_limit: number
        }[]
      }
      invoke_edge_function: {
        Args: { function_name: string; payload?: Json }
        Returns: number
      }
      is_group_room_member: {
        Args: { p_room_id: string; p_user_id?: string }
        Returns: boolean
      }
      is_handle_owner: { Args: { p_handle: string }; Returns: boolean }
      mark_activity_seen: { Args: never; Returns: undefined }
      match_engrams: {
        Args: {
          match_count?: number
          p_agent_id?: string
          p_user_id?: string
          query_text: string
        }
        Returns: {
          access_count: number
          accessibility: number
          agent_id: string
          content: string
          created_at: string
          emotional_arousal: number
          emotional_valence: number
          engram_type: string
          id: string
          last_accessed_at: string
          similarity: number
          source_context: Json
          stability: number
          state: string
          strength: number
          surprise_score: number
          tags: string[]
          updated_at: string
          user_id: string
        }[]
      }
      match_engrams_vector: {
        Args: {
          match_count?: number
          min_strength?: number
          p_agent_id?: string
          p_user_id?: string
          query_embedding: string
        }
        Returns: {
          access_count: number
          accessibility: number
          agent_id: string
          content: string
          created_at: string
          emotional_arousal: number
          emotional_valence: number
          engram_type: string
          id: string
          last_accessed_at: string
          similarity: number
          source_context: Json
          stability: number
          state: string
          strength: number
          surprise_score: number
          tags: string[]
          updated_at: string
          user_id: string
        }[]
      }
      match_hypomnema_vector: {
        Args: {
          match_count?: number
          p_agent_id?: string
          p_user_id?: string
          query_embedding: string
        }
        Returns: {
          agent_id: string
          content: string
          density: string
          domain: string
          id: string
          similarity: number
          user_id: string
        }[]
      }
      match_memories: {
        Args: {
          match_count?: number
          p_agent_id?: string
          p_user_id?: string
          query_text: string
        }
        Returns: {
          confidence: number
          content: string
          created_at: string
          emotional_intensity: number
          emotional_valence: number
          estimated_date: string
          id: string
          memory_type: string
          provenance: Json
          similarity: number
          tags: string[]
        }[]
      }
      mnemos_belief_is_legacy_pollution: {
        Args: { p_content: string; p_source: string }
        Returns: boolean
      }
      mnemos_cleanup_legacy_beliefs: {
        Args: { p_cohort_only?: boolean; p_commit?: boolean; p_limit?: number }
        Returns: Json
      }
      mnemos_cohort: { Args: never; Returns: string[] }
      mnemos_digest_backlog_drain: {
        Args: {
          p_arousal_max?: number
          p_cohort_only?: boolean
          p_commit?: boolean
          p_limit?: number
          p_surprise_max?: number
        }
        Returns: Json
      }
      mnemos_digest_sensitive_tags: { Args: never; Returns: string[] }
      mnemos_engram_autoconfirmable: {
        Args: {
          p_arousal: number
          p_arousal_max?: number
          p_surprise: number
          p_surprise_max?: number
          p_tags: string[]
        }
        Returns: boolean
      }
      mnemos_reconsolidate: {
        Args: { p_agent_id: string; p_engram_ids: string[]; p_user_id: string }
        Returns: number
      }
      mnemos_rehearse_scope: {
        Args: {
          p_agent_id: string
          p_budget?: number
          p_user_id: string
          p_value_floor?: number
        }
        Returns: number
      }
      mnemos_run_belief_challenge_cohort: { Args: never; Returns: Json }
      mnemos_run_digest_autoreview_cohort: {
        Args: { p_arousal_max?: number; p_surprise_max?: number }
        Returns: Json
      }
      mnemos_run_digest_build_cohort: { Args: never; Returns: Json }
      mnemos_run_health_snapshot: { Args: never; Returns: Json }
      mnemos_run_identity_derivation_cohort: { Args: never; Returns: Json }
      mnemos_run_rehearsal_cohort: { Args: never; Returns: Json }
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
      }
      openclaw_verify_device_token: {
        Args: { p_device_id: string; p_token: string }
        Returns: boolean
      }
      prune_cron_job_run_details:
        | { Args: never; Returns: number }
        | { Args: { p_retention?: string }; Returns: number }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
      reap_stuck_imports: { Args: never; Returns: number }
      record_cron_run: {
        Args: {
          p_duration_ms: number
          p_error?: string
          p_job_name: string
          p_success: boolean
        }
        Returns: undefined
      }
      save_user_api_key: { Args: { p_key: string }; Returns: undefined }
    }
    Enums: {
      app_role: "admin" | "moderator" | "user"
      chat_attachment_status:
        | "uploading"
        | "quarantined"
        | "scanning"
        | "extracting"
        | "ready"
        | "failed"
        | "rejected"
        | "cancelled"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "moderator", "user"],
      chat_attachment_status: [
        "uploading",
        "quarantined",
        "scanning",
        "extracting",
        "ready",
        "failed",
        "rejected",
        "cancelled",
      ],
    },
  },
} as const
