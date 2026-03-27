import credits.aleo;
import test_usdcx_stablecoin.aleo;

program sub_invoice_v8_xwnxp.aleo {
    @admin(address = "aleo1jvs27kq44uzn8ry5st8mrj6f2cjef93hst7p6ft0rq86gqg8w59q3vw492")
    async constructor() {}

    const BASIC_TIER_MIN_MICROCREDITS: u64 = 1_000_000u64;
    const PREMIUM_TIER_MIN_MICROCREDITS: u64 = 10_000_000u64;
    const BASIC_TIER_MIN_USDCX_SUBUNITS: u128 = 1_000_000u128;
    const PREMIUM_TIER_MIN_USDCX_SUBUNITS: u128 = 10_000_000u128;

    mapping active_subscriptions: field => u32;
    mapping salt_to_subscription: field => field;

    struct SubscriptionKey {
        invoice_owner: address,
        circle_id: field,
    }

    struct InvoiceReplayKey {
        invoice_owner: address,
        circle_id: field,
        expires_at: u32,
        salt: field,
    }

    record SubscriptionInvoice {
        owner: address,
        circle_id: field,
        expires_at: u32,
        tier: u8,
        salt: field,
    }

    record CreatorReceipt {
        owner: address,
        circle_id: field,
        receipt_hash: field,
        tier: u8,
        expires_at: u32,
    }

    function compute_subscription_key(invoice_owner: address, circle_id: field) -> field {
        let subscription_key: SubscriptionKey = SubscriptionKey {
            invoice_owner: invoice_owner,
            circle_id: circle_id,
        };
        return BHP256::hash_to_field(subscription_key);
    }

    function compute_invoice_nullifier(
        invoice_owner: address,
        circle_id: field,
        expires_at: u32,
        salt: field,
    ) -> field {
        let replay_key: InvoiceReplayKey = InvoiceReplayKey {
            invoice_owner: invoice_owner,
            circle_id: circle_id,
            expires_at: expires_at,
            salt: salt,
        };
        return BHP256::hash_to_field(replay_key);
    }

    function compute_receipt_hash(circle_id: field, salt: field) -> field {
        let salt_scalar: scalar = BHP256::hash_to_scalar(salt);
        return BHP256::commit_to_field(circle_id, salt_scalar);
    }

    function tier_for_amount(amount: u64) -> u8 {
        assert(amount >= BASIC_TIER_MIN_MICROCREDITS);
        return amount >= PREMIUM_TIER_MIN_MICROCREDITS ? 2u8 : 1u8;
    }

    function tier_for_amount_usdcx(amount: u128) -> u8 {
        assert(amount >= BASIC_TIER_MIN_USDCX_SUBUNITS);
        return amount >= PREMIUM_TIER_MIN_USDCX_SUBUNITS ? 2u8 : 1u8;
    }

    async transition pay_and_subscribe(
        private payment: credits.aleo/credits,
        public circle_id: field,
        public amount: u64,
        public expires_at: u32,
        private salt: field,
        public creator_address: address,
    ) -> (SubscriptionInvoice, CreatorReceipt, credits.aleo/credits, credits.aleo/credits, Future) {
        let tier: u8 = tier_for_amount(amount);
        let subscription_key: field = compute_subscription_key(self.signer, circle_id);
        let salt_hash: field = BHP256::hash_to_field(salt);
        let receipt_hash: field = compute_receipt_hash(circle_id, salt);
        assert(payment.microcredits >= amount);

        let (change, creator_record) = credits.aleo/transfer_private(
            payment,
            creator_address,
            amount,
        );

        return (
            SubscriptionInvoice {
                owner: self.signer,
                circle_id: circle_id,
                expires_at: expires_at,
                tier: tier,
                salt: salt,
            },
            CreatorReceipt {
                owner: creator_address,
                circle_id: circle_id,
                receipt_hash: receipt_hash,
                tier: tier,
                expires_at: expires_at,
            },
            change,
            creator_record,
            finalize_pay_and_subscribe(subscription_key, expires_at, salt_hash),
        );
    }

    async function finalize_pay_and_subscribe(
        public subscription_key: field,
        public expires_at: u32,
        public salt_hash: field,
    ) {
        let existing: u32 = active_subscriptions.get_or_use(subscription_key, 0u32);
        assert(existing < expires_at);
        assert(expires_at > block.height);
        active_subscriptions.set(subscription_key, expires_at);
        salt_to_subscription.set(salt_hash, subscription_key);
    }

    async transition pay_and_subscribe_public(
        public circle_id: field,
        public amount: u64,
        public expires_at: u32,
        private salt: field,
        public creator_address: address,
    ) -> (SubscriptionInvoice, CreatorReceipt, Future) {
        let tier: u8 = tier_for_amount(amount);
        let subscription_key: field = compute_subscription_key(self.signer, circle_id);
        let salt_hash: field = BHP256::hash_to_field(salt);
        let receipt_hash: field = compute_receipt_hash(circle_id, salt);
        let settle_payment: Future = credits.aleo/transfer_public_as_signer(
            creator_address,
            amount,
        );

        return (
            SubscriptionInvoice {
                owner: self.signer,
                circle_id: circle_id,
                expires_at: expires_at,
                tier: tier,
                salt: salt,
            },
            CreatorReceipt {
                owner: creator_address,
                circle_id: circle_id,
                receipt_hash: receipt_hash,
                tier: tier,
                expires_at: expires_at,
            },
            finalize_pay_public(settle_payment, subscription_key, expires_at, salt_hash),
        );
    }

    async function finalize_pay_public(
        payment_future: Future,
        public subscription_key: field,
        public expires_at: u32,
        public salt_hash: field,
    ) {
        let existing: u32 = active_subscriptions.get_or_use(subscription_key, 0u32);
        assert(existing < expires_at);
        assert(expires_at > block.height);
        payment_future.await();
        active_subscriptions.set(subscription_key, expires_at);
        salt_to_subscription.set(salt_hash, subscription_key);
    }

    async transition pay_and_subscribe_usdcx(
        private payment: test_usdcx_stablecoin.aleo/Token,
        public circle_id: field,
        public amount: u128,
        public expires_at: u32,
        private salt: field,
        public creator_address: address,
        private proofs: [test_usdcx_stablecoin.aleo/MerkleProof; 2],
    ) -> (
        SubscriptionInvoice,
        CreatorReceipt,
        test_usdcx_stablecoin.aleo/Token,
        test_usdcx_stablecoin.aleo/Token,
        test_usdcx_stablecoin.aleo/ComplianceRecord,
        Future
    ) {
        let tier: u8 = tier_for_amount_usdcx(amount);
        let subscription_key: field = compute_subscription_key(self.signer, circle_id);
        let salt_hash: field = BHP256::hash_to_field(salt);
        let receipt_hash: field = compute_receipt_hash(circle_id, salt);

        let (compliance_record, creator_record, change_record, settle_payment): (
            test_usdcx_stablecoin.aleo/ComplianceRecord,
            test_usdcx_stablecoin.aleo/Token,
            test_usdcx_stablecoin.aleo/Token,
            Future
        ) = test_usdcx_stablecoin.aleo/transfer_private(creator_address, amount, payment, proofs);

        return (
            SubscriptionInvoice {
                owner: self.signer,
                circle_id: circle_id,
                expires_at: expires_at,
                tier: tier,
                salt: salt,
            },
            CreatorReceipt {
                owner: creator_address,
                circle_id: circle_id,
                receipt_hash: receipt_hash,
                tier: tier,
                expires_at: expires_at,
            },
            creator_record,
            change_record,
            compliance_record,
            finalize_pay_sub_usdcx(settle_payment, subscription_key, expires_at, salt_hash),
        );
    }

    async function finalize_pay_sub_usdcx(
        payment_future: Future,
        public subscription_key: field,
        public expires_at: u32,
        public salt_hash: field,
    ) {
        let existing: u32 = active_subscriptions.get_or_use(subscription_key, 0u32);
        assert(existing < expires_at);
        assert(expires_at > block.height);
        payment_future.await();
        active_subscriptions.set(subscription_key, expires_at);
        salt_to_subscription.set(salt_hash, subscription_key);
    }

    async transition pay_and_subscribe_usdcx_public(
        public circle_id: field,
        public amount: u128,
        public expires_at: u32,
        private salt: field,
        public creator_address: address,
    ) -> (SubscriptionInvoice, CreatorReceipt, Future) {
        let tier: u8 = tier_for_amount_usdcx(amount);
        let subscription_key: field = compute_subscription_key(self.signer, circle_id);
        let salt_hash: field = BHP256::hash_to_field(salt);
        let receipt_hash: field = compute_receipt_hash(circle_id, salt);
        let settle_payment: Future = test_usdcx_stablecoin.aleo/transfer_public_as_signer(
            creator_address,
            amount,
        );

        return (
            SubscriptionInvoice {
                owner: self.signer,
                circle_id: circle_id,
                expires_at: expires_at,
                tier: tier,
                salt: salt,
            },
            CreatorReceipt {
                owner: creator_address,
                circle_id: circle_id,
                receipt_hash: receipt_hash,
                tier: tier,
                expires_at: expires_at,
            },
            finalize_pay_pub_usdcx(settle_payment, subscription_key, expires_at, salt_hash),
        );
    }

    async function finalize_pay_pub_usdcx(
        payment_future: Future,
        public subscription_key: field,
        public expires_at: u32,
        public salt_hash: field,
    ) {
        let existing: u32 = active_subscriptions.get_or_use(subscription_key, 0u32);
        assert(existing < expires_at);
        assert(expires_at > block.height);
        payment_future.await();
        active_subscriptions.set(subscription_key, expires_at);
        salt_to_subscription.set(salt_hash, subscription_key);
    }

    transition invoice_nullifier(invoice: SubscriptionInvoice) -> (field, SubscriptionInvoice) {
        let nullifier: field = compute_invoice_nullifier(invoice.owner, invoice.circle_id, invoice.expires_at, invoice.salt);
        return (nullifier, invoice);
    }

    async transition verify_subscription(
        invoice: SubscriptionInvoice,
        public circle_id: field,
        public expected_tier: u8,
    ) -> (bool, SubscriptionInvoice, Future) {
        assert_eq(invoice.circle_id, circle_id);
        assert_eq(invoice.tier, expected_tier);
        let subscription_key: field = compute_subscription_key(invoice.owner, invoice.circle_id);
        return (true, invoice, finalize_verify_subscription(subscription_key, invoice.expires_at));
    }

    async function finalize_verify_subscription(
        public subscription_key: field,
        public expires_at: u32,
    ) {
        let active_expiry: u32 = active_subscriptions.get_or_use(subscription_key, 0u32);
        assert_eq(active_expiry, expires_at);
        assert(active_expiry > block.height);
    }
}
