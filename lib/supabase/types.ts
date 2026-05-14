export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      users: {
        Row: {
          id: string;
          email: string;
          first_name: string | null;
          last_name: string | null;
          role: 'admin' | 'manager' | 'analyst' | 'viewer';
          department: string | null;
          is_active: boolean;
          last_login_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          email: string;
          first_name?: string | null;
          last_name?: string | null;
          role?: 'admin' | 'manager' | 'analyst' | 'viewer';
          department?: string | null;
          is_active?: boolean;
          last_login_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          email?: string;
          first_name?: string | null;
          last_name?: string | null;
          role?: 'admin' | 'manager' | 'analyst' | 'viewer';
          department?: string | null;
          is_active?: boolean;
          last_login_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      rfqs: {
        Row: {
          id: string;
          rfq_number: string;
          title: string;
          description: string | null;
          status: 'draft' | 'published' | 'in_review' | 'awarded' | 'cancelled';
          budget_min: number | null;
          budget_max: number | null;
          currency: string;
          submission_deadline: string | null;
          created_by: string;
          assigned_to: string | null;
          priority: 'low' | 'medium' | 'high' | 'urgent';
          category: string | null;
          tags: string[] | null;
          metadata: Json | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          rfq_number: string;
          title: string;
          description?: string | null;
          status?: 'draft' | 'published' | 'in_review' | 'awarded' | 'cancelled';
          budget_min?: number | null;
          budget_max?: number | null;
          currency?: string;
          submission_deadline?: string | null;
          created_by: string;
          assigned_to?: string | null;
          priority?: 'low' | 'medium' | 'high' | 'urgent';
          category?: string | null;
          tags?: string[] | null;
          metadata?: Json | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          rfq_number?: string;
          title?: string;
          description?: string | null;
          status?: 'draft' | 'published' | 'in_review' | 'awarded' | 'cancelled';
          budget_min?: number | null;
          budget_max?: number | null;
          currency?: string;
          submission_deadline?: string | null;
          created_by?: string;
          assigned_to?: string | null;
          priority?: 'low' | 'medium' | 'high' | 'urgent';
          category?: string | null;
          tags?: string[] | null;
          metadata?: Json | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'rfqs_assigned_to_fkey';
            columns: ['assigned_to'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'rfqs_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          }
        ];
      };
      audit_logs: {
        Row: {
          id: string;
          entity_type: string;
          entity_id: string;
          action: 'INSERT' | 'UPDATE' | 'DELETE';
          old_values: Json | null;
          new_values: Json | null;
          user_id: string | null;
          user_email: string | null;
          ip_address: string | null;
          user_agent: string | null;
          timestamp: string;
        };
        Insert: {
          id?: string;
          entity_type: string;
          entity_id: string;
          action: 'INSERT' | 'UPDATE' | 'DELETE';
          old_values?: Json | null;
          new_values?: Json | null;
          user_id?: string | null;
          user_email?: string | null;
          ip_address?: string | null;
          user_agent?: string | null;
          timestamp?: string;
        };
        Update: {
          id?: never;
          entity_type?: never;
          entity_id?: never;
          action?: never;
          old_values?: never;
          new_values?: never;
          user_id?: never;
          user_email?: never;
          ip_address?: never;
          user_agent?: never;
          timestamp?: never;
        };
        Relationships: [
          {
            foreignKeyName: 'audit_logs_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          }
        ];
      };
    };
    Views: {};
    Functions: {};
    Enums: {
      user_role: 'admin' | 'manager' | 'analyst' | 'viewer';
      rfq_status: 'draft' | 'published' | 'in_review' | 'awarded' | 'cancelled';
      rfq_priority: 'low' | 'medium' | 'high' | 'urgent';
      audit_action: 'INSERT' | 'UPDATE' | 'DELETE';
    };
    CompositeTypes: {};
  };
}

export type Tables<
  PublicTableNameOrOptions extends
    | keyof (Database['public']['Tables'] & Database['public']['Views'])
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof (Database[PublicTableNameOrOptions['schema']]['Tables'] &
        Database[PublicTableNameOrOptions['schema']]['Views'])
    : never = never
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? (Database[PublicTableNameOrOptions['schema']]['Tables'] &
      Database[PublicTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : PublicTableNameOrOptions extends keyof (Database['public']['Tables'] &
      Database['public']['Views'])
  ? (Database['public']['Tables'] &
      Database['public']['Views'])[PublicTableNameOrOptions] extends {
      Row: infer R;
    }
    ? R
    : never
  : never;

export type TablesInsert<
  PublicTableNameOrOptions extends
    | keyof Database['public']['Tables']
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicTableNameOrOptions['schema']]['Tables']
    : never = never
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? Database[PublicTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : PublicTableNameOrOptions extends keyof Database['public']['Tables']
  ? Database['public']['Tables'][PublicTableNameOrOptions] extends {
      Insert: infer I;
    }
    ? I
    : never
  : never;

export type TablesUpdate<
  PublicTableNameOrOptions extends
    | keyof Database['public']['Tables']
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicTableNameOrOptions['schema']]['Tables']
    : never = never
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? Database[PublicTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : PublicTableNameOrOptions extends keyof Database['public']['Tables']
  ? Database['public']['Tables'][PublicTableNameOrOptions] extends {
      Update: infer U;
    }
    ? U
    : never
  : never;

export type Enums<
  PublicEnumNameOrOptions extends
    | keyof Database['public']['Enums']
    | { schema: keyof Database },
  EnumName extends PublicEnumNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicEnumNameOrOptions['schema']]['Enums']
    : never = never
> = PublicEnumNameOrOptions extends { schema: keyof Database }
  ? Database[PublicEnumNameOrOptions['schema']]['Enums'][EnumName]
  : PublicEnumNameOrOptions extends keyof Database['public']['Enums']
  ? Database['public']['Enums'][PublicEnumNameOrOptions]
  : never;