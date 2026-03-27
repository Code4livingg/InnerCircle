import credits.aleo;
import test_usdcx_stablecoin.aleo;

program sub_pay_v6_xwnxp.aleo {
    @admin(address = "aleo1jvs27kq44uzn8ry5st8mrj6f2cjef93hst7p6ft0rq86gqg8w59q3vw492")
    async constructor() {}

    const SUBSCRIPTION_TERM_BLOCKS: u32 = 43200u32;

    mapping active_subs: field => u32;

    struct SubscriptionKey {
        subscriber: address,
        creator_id: field,
    }

    record Subscription {
        owner: address,
        creator_id: field,
        expiry: field,
    }

    function compute_subscription_key(owner: address, creator_id: field) -> field {
        let subscription_key: SubscriptionKey = SubscriptionKey {
            subscriber: owner,
            creator_id: creator_id,
        };
        return BHP256::hash_to_field(subscription_key);
    }

    // Legacy path kept stable for upgrade compatibility with already-deployed state/signatures.
    async transition pay_and_subscribe(
        public creator_id: field,
        public creator_address: address,
        public price: u64,
    ) -> (Subscription, Future) {
        assert(price > 0u64);
        let fut: Future = credits.aleo/transfer_public(creator_address, price);
        return (
            Subscription {
                owner: self.signer,
                creator_id: creator_id,
                expiry: 0field,
            },
            finalize_pay_and_subscribe(fut),
        );
    }

    // Legacy expiry-aware path preserved for compatibility.
    async transition pay_and_subscribe_v2(
        public creator_id: field,
        public creator_address: address,
        public price: u64,
        public expiry: field,
    ) -> (Subscription, Future) {
        assert(price > 0u64);
        let fut: Future = credits.aleo/transfer_public(creator_address, price);
        return (
            Subscription {
                owner: self.signer,
                creator_id: creator_id,
                expiry: expiry,
            },
            finalize_pay_and_subscribe_v2(fut),
        );
    }

    async function finalize_pay_and_subscribe(f: Future) {
        f.await();
    }

    async function finalize_pay_and_subscribe_v2(f: Future) {
        f.await();
    }

    transition prove_subscription(
        subscription: Subscription,
        public creator_id: field,
    ) -> bool {
        assert_eq(subscription.owner, self.signer);
        assert_eq(subscription.creator_id, creator_id);
        return true;
    }

    transition prove_subscription_v2(
        subscription: Subscription,
        public creator_id: field,
        public current_height: field,
    ) -> bool {
        assert_eq(subscription.owner, self.signer);
        assert_eq(subscription.creator_id, creator_id);
        assert(subscription.expiry != 0field);
        assert(subscription.expiry > current_height);
        return true;
    }

    async transition pay_and_subscribe_guarded(
        public creator_id: field,
        public creator_address: address,
        public price: u64,
    ) -> (Subscription, Future) {
        assert(price > 0u64);
        let subscription_key: field = compute_subscription_key(self.signer, creator_id);
        let f: Future = credits.aleo/transfer_public(creator_address, price);
        return (
            Subscription {
                owner: self.signer,
                creator_id: creator_id,
                expiry: 0field,
            },
            finalize_pay_guarded(f, subscription_key),
        );
    }

    async function finalize_pay_guarded(
        f: Future,
        public subscription_key: field,
    ) {
        let existing: u32 = active_subs.get_or_use(subscription_key, 0u32);
        assert(existing < block.height);
        let expiry_height: u32 = block.height + SUBSCRIPTION_TERM_BLOCKS;
        assert(expiry_height > block.height);
        f.await();
        active_subs.set(subscription_key, expiry_height);
    }

    async transition prove_subscription_safe(
        subscription: Subscription,
        public creator_id: field,
    ) -> (bool, Subscription, Future) {
        assert_eq(subscription.owner, self.signer);
        assert_eq(subscription.creator_id, creator_id);
        let subscription_key: field = compute_subscription_key(subscription.owner, creator_id);
        return (true, subscription, finalize_prove_sub_safe(subscription_key));
    }

    async function finalize_prove_sub_safe(public subscription_key: field) {
        let expiry: u32 = active_subs.get_or_use(subscription_key, 0u32);
        assert(expiry > block.height);
    }

    async transition pay_and_subscribe_usdcx(
        public creator_id: field,
        public creator_address: address,
        public price: u128,
        private payment: test_usdcx_stablecoin.aleo/Token,
        private proofs: [test_usdcx_stablecoin.aleo/MerkleProof; 2],
    ) -> (
        Subscription,
        test_usdcx_stablecoin.aleo/Token,
        test_usdcx_stablecoin.aleo/Token,
        test_usdcx_stablecoin.aleo/ComplianceRecord,
        Future
    ) {
        let (compliance_record, creator_record, change_record, f): (
            test_usdcx_stablecoin.aleo/ComplianceRecord,
            test_usdcx_stablecoin.aleo/Token,
            test_usdcx_stablecoin.aleo/Token,
            Future
        ) = test_usdcx_stablecoin.aleo/transfer_private(creator_address, price, payment, proofs);
        return (
            Subscription {
                owner: self.signer,
                creator_id: creator_id,
                expiry: 0field,
            },
            creator_record,
            change_record,
            compliance_record,
            finalize_pay_sub_usdcx(f),
        );
    }

    async function finalize_pay_sub_usdcx(f: Future) {
        f.await();
    }

    async transition pay_and_subscribe_usdcx_public(
        public creator_id: field,
        public creator_address: address,
        public price: u128,
    ) -> (Subscription, Future) {
        let f: Future = test_usdcx_stablecoin.aleo/transfer_public_as_signer(creator_address, price);
        return (
            Subscription {
                owner: self.signer,
                creator_id: creator_id,
                expiry: 0field,
            },
            finalize_pay_sub_usdcx_pub(f),
        );
    }

    async function finalize_pay_sub_usdcx_pub(f: Future) {
        f.await();
    }

    async transition pay_sub_usdcx_guarded(
        public creator_id: field,
        public creator_address: address,
        public price: u128,
        private payment: test_usdcx_stablecoin.aleo/Token,
        private proofs: [test_usdcx_stablecoin.aleo/MerkleProof; 2],
    ) -> (
        Subscription,
        test_usdcx_stablecoin.aleo/Token,
        test_usdcx_stablecoin.aleo/Token,
        test_usdcx_stablecoin.aleo/ComplianceRecord,
        Future
    ) {
        let subscription_key: field = compute_subscription_key(self.signer, creator_id);
        let (compliance_record, creator_record, change_record, f): (
            test_usdcx_stablecoin.aleo/ComplianceRecord,
            test_usdcx_stablecoin.aleo/Token,
            test_usdcx_stablecoin.aleo/Token,
            Future
        ) = test_usdcx_stablecoin.aleo/transfer_private(creator_address, price, payment, proofs);
        return (
            Subscription {
                owner: self.signer,
                creator_id: creator_id,
                expiry: 0field,
            },
            creator_record,
            change_record,
            compliance_record,
            finalize_pay_ucx_guard(f, subscription_key),
        );
    }

    async function finalize_pay_ucx_guard(
        f: Future,
        public subscription_key: field,
    ) {
        let existing: u32 = active_subs.get_or_use(subscription_key, 0u32);
        assert(existing < block.height);
        let expiry_height: u32 = block.height + SUBSCRIPTION_TERM_BLOCKS;
        assert(expiry_height > block.height);
        f.await();
        active_subs.set(subscription_key, expiry_height);
    }

    async transition pay_sub_usdcx_pub_guard(
        public creator_id: field,
        public creator_address: address,
        public price: u128,
    ) -> (Subscription, Future) {
        let subscription_key: field = compute_subscription_key(self.signer, creator_id);
        let f: Future = test_usdcx_stablecoin.aleo/transfer_public_as_signer(creator_address, price);
        return (
            Subscription {
                owner: self.signer,
                creator_id: creator_id,
                expiry: 0field,
            },
            finalize_pay_ucx_pub_guard(f, subscription_key),
        );
    }

    async function finalize_pay_ucx_pub_guard(
        f: Future,
        public subscription_key: field,
    ) {
        let existing: u32 = active_subs.get_or_use(subscription_key, 0u32);
        assert(existing < block.height);
        let expiry_height: u32 = block.height + SUBSCRIPTION_TERM_BLOCKS;
        assert(expiry_height > block.height);
        f.await();
        active_subs.set(subscription_key, expiry_height);
    }
}
