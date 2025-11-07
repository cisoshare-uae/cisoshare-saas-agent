/**
 * Agent API Response Transformers
 *
 * Converts PostgreSQL snake_case results to platform-expected camelCase
 * Handles BIGINT -> number conversion
 */

/**
 * Transform a single document from snake_case to camelCase
 */
export function transformDocument(doc: any) {
    if (!doc) return null;

    return {
        id: doc.id,
        tenantId: doc.tenant_id,
        documentNumber: doc.document_number,
        title: doc.title,
        description: doc.description,
        entityType: doc.entity_type,
        entityId: doc.entity_id,
        category: doc.category,
        tags: doc.tags,
        fileName: doc.file_name,
        fileSize: parseInt(doc.file_size) || 0,
        fileType: doc.file_type,
        filePath: doc.file_path,
        fileHash: doc.file_hash,
        mimeType: doc.mime_type,
        isEncrypted: doc.is_encrypted,
        encryptionKeyId: doc.encryption_key_id,
        version: doc.version,
        versionMetadata: doc.version_metadata,
        parentDocumentId: doc.parent_document_id,
        isLatestVersion: doc.is_latest_version,
        changeSummary: doc.change_summary,
        supersededBy: doc.superseded_by,
        status: doc.status,
        issueDate: doc.issue_date,
        expiryDate: doc.expiry_date,
        renewalRequired: doc.renewal_required,
        renewalPeriodDays: doc.renewal_period_days,
        gracePeriodDays: doc.grace_period_days,
        lastRenewalNotificationDate: doc.last_renewal_notification_date,
        autoArchiveOnExpiry: doc.auto_archive_on_expiry,
        containsPii: doc.contains_pii,
        containsPhi: doc.contains_phi,
        sensitivityLevel: doc.sensitivity_level,
        retentionPeriodYears: doc.retention_period_years,
        legalHold: doc.legal_hold,
        legalHoldReason: doc.legal_hold_reason,
        disposalDate: doc.disposal_date,
        aiExtractedData: doc.ai_extracted_data,
        aiExtractionStatus: doc.ai_extraction_status,
        aiExtractionConfidence: doc.ai_extraction_confidence,
        customMetadata: doc.custom_metadata,
        // Enhanced fields from migration 019
        structuredContent: doc.structured_content,
        contentFormat: doc.content_format,
        editorState: doc.editor_state,
        templateId: doc.template_id,
        templateVersion: doc.template_version,
        mcpVersion: doc.mcp_version,
        mcpComplianceScore: doc.mcp_compliance_score,
        lastMcpCheck: doc.last_mcp_check,
        mcpRequirementsChecked: doc.mcp_requirements_checked,
        contentHash: doc.content_hash,
        parsingStatus: doc.parsing_status,
        parsingError: doc.parsing_error,
        createdBy: doc.created_by,
        createdAt: doc.created_at,
        updatedBy: doc.updated_by,
        updatedAt: doc.updated_at
    };
}

/**
 * Transform a comment from snake_case to camelCase
 */
export function transformComment(comment: any) {
    if (!comment) return null;

    return {
        id: comment.id,
        tenantId: comment.tenant_id,
        documentId: comment.document_id,
        parentCommentId: comment.parent_comment_id,
        commentText: comment.comment_text,
        commentType: comment.comment_type,
        authorId: comment.author_id,
        authorName: comment.author_name,
        authorRole: comment.author_role,
        isResolved: comment.is_resolved,
        resolvedBy: comment.resolved_by,
        resolvedAt: comment.resolved_at,
        isInternal: comment.is_internal,
        hasAttachments: comment.has_attachments,
        attachments: comment.attachments,
        createdBy: comment.created_by,
        createdAt: comment.created_at,
        updatedAt: comment.updated_at,
        deletedAt: comment.deleted_at,
        // Include nested replies if present
        replies: comment.replies ? comment.replies.map(transformComment) : undefined
    };
}

/**
 * Transform an approval from snake_case to camelCase
 */
export function transformApproval(approval: any) {
    if (!approval) return null;

    return {
        id: approval.id,
        tenantId: approval.tenant_id,
        documentId: approval.document_id,
        approvalLevel: approval.approval_level,
        approvalType: approval.approval_type,
        approverId: approval.approver_id,
        approverRole: approval.approver_role,
        status: approval.status,
        decisionDate: approval.decision_date,
        comments: approval.comments,
        rejectionReason: approval.rejection_reason,
        delegatedTo: approval.delegated_to,
        delegatedAt: approval.delegated_at,
        delegationReason: approval.delegation_reason,
        escalatedTo: approval.escalated_to,
        escalatedAt: approval.escalated_at,
        escalationReason: approval.escalation_reason,
        requestedAt: approval.requested_at,
        dueDate: approval.due_date,
        reminderSentAt: approval.reminder_sent_at,
        createdAt: approval.created_at,
        updatedAt: approval.updated_at
    };
}

/**
 * Transform a share from snake_case to camelCase
 */
export function transformShare(share: any) {
    if (!share) return null;

    return {
        id: share.id,
        tenantId: share.tenant_id,
        documentId: share.document_id,
        sharedBy: share.shared_by,
        sharedWithUserId: share.shared_with_user_id,
        sharedWithEmail: share.shared_with_email,
        shareType: share.share_type,
        accessToken: share.access_token,
        passwordProtected: share.password_protected,
        passwordHash: share.password_hash,
        expiresAt: share.expires_at,
        maxAccessCount: share.max_access_count,
        currentAccessCount: share.current_access_count,
        isActive: share.is_active,
        revokedAt: share.revoked_at,
        revokedBy: share.revoked_by,
        revocationReason: share.revocation_reason,
        createdAt: share.created_at,
        lastAccessedAt: share.last_accessed_at
    };
}

/**
 * Transform a relationship from snake_case to camelCase
 */
export function transformRelationship(rel: any) {
    if (!rel) return null;

    return {
        id: rel.id,
        tenantId: rel.tenant_id,
        sourceDocumentId: rel.source_document_id,
        targetDocumentId: rel.target_document_id,
        relationshipType: rel.relationship_type,
        description: rel.description,
        createdBy: rel.created_by,
        createdAt: rel.created_at,
        // Include related document details if joined
        sourceDocument: rel.source_title ? {
            id: rel.source_document_id,
            documentNumber: rel.source_number,
            title: rel.source_title,
            status: rel.source_status
        } : undefined,
        targetDocument: rel.target_title ? {
            id: rel.target_document_id,
            documentNumber: rel.target_number,
            title: rel.target_title,
            status: rel.target_status
        } : undefined
    };
}

/**
 * Transform a template from snake_case to camelCase
 */
export function transformTemplate(template: any) {
    if (!template) return null;

    return {
        id: template.id,
        tenantId: template.tenant_id,
        templateName: template.template_name,
        templateCode: template.template_code,
        description: template.description,
        category: template.category,
        entityType: template.entity_type,
        templateFilePath: template.template_file_path,
        templateFileType: template.template_file_type,
        variables: template.variables,
        isActive: template.is_active,
        requireApproval: template.require_approval,
        defaultApprovalWorkflow: template.default_approval_workflow,
        hasExpiry: template.has_expiry,
        defaultValidityDays: template.default_validity_days,
        defaultRenewalPeriodDays: template.default_renewal_period_days,
        usageCount: template.usage_count,
        lastUsedAt: template.last_used_at,
        version: template.version,
        // Enhanced fields from migration 019
        adhicsDomains: template.adhics_domains,
        adhicsRequirements: template.adhics_requirements,
        adhicsComplianceLevel: template.adhics_compliance_level,
        mcpGenerated: template.mcp_generated,
        mcpVersion: template.mcp_version,
        mcpLastSync: template.mcp_last_sync,
        structuredSections: template.structured_sections,
        contentSchema: template.content_schema,
        titleAr: template.title_ar,
        descriptionAr: template.description_ar,
        language: template.language,
        complexity: template.complexity,
        estimatedTimeMinutes: template.estimated_time_minutes,
        requiredApprovals: template.required_approvals,
        tags: template.tags,
        rating: template.rating,
        thumbnailUrl: template.thumbnail_url,
        createdBy: template.created_by,
        createdAt: template.created_at,
        updatedBy: template.updated_by,
        updatedAt: template.updated_at,
        deletedAt: template.deleted_at
    };
}

/**
 * Transform a template field from snake_case to camelCase
 */
export function transformTemplateField(field: any) {
    if (!field) return null;

    return {
        id: field.id,
        templateId: field.template_id,
        tenantId: field.tenant_id,
        fieldName: field.field_name,
        fieldLabel: field.field_label,
        fieldLabelAr: field.field_label_ar,
        fieldType: field.field_type,
        dataSource: field.data_source,
        dataSourceEntity: field.data_source_entity,
        dataSourceField: field.data_source_field,
        dataSourceQuery: field.data_source_query,
        isRequired: field.is_required,
        validationRules: field.validation_rules,
        defaultValue: field.default_value,
        placeholder: field.placeholder,
        helpText: field.help_text,
        options: field.options,
        orderIndex: field.order_index,
        groupName: field.group_name,
        isConditional: field.is_conditional,
        conditionalLogic: field.conditional_logic,
        createdAt: field.created_at,
        updatedAt: field.updated_at
    };
}

/**
 * Transform array of items
 */
export function transformArray<T>(items: any[], transformFn: (item: any) => T): T[] {
    if (!Array.isArray(items)) return [];
    return items.map(transformFn);
}
