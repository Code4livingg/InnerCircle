import credits.aleo;
import test_usdcx_stablecoin.aleo;

program ppv_pay_v5_xwnxp.aleo {
    @admin(address = "aleo1jvs27kq44uzn8ry5st8mrj6f2cjef93hst7p6ft0rq86gqg8w59q3vw492")
    async constructor() {}

    mapping purchased_content: field => bool;

    struct PurchaseKey {
        buyer: address,
        content_id: field,
    }

    record ContentAccess {
        owner: address,
        content_id: field,
    }

    record TimedContentAccess {
        owner: address,
        content_id: field,
        expiry_height: u32,
    }

    function compute_purchase_key(buyer: address, content_id: field) -> field {
        let purchase_key: PurchaseKey = PurchaseKey {
            buyer: buyer,
            content_id: content_id,
        };
        return BHP256::hash_to_field(purchase_key);
    }

    // buy_content transfers `price` microcredits from caller to `creator_address`,
    // then mints a private ContentAccess record proving ownership.
    async transition buy_content(
        public content_id: field,
        public creator_address: address,
        public price: u64,
    ) -> (ContentAccess, Future) {
        assert(price > 0u64);
        let fut: Future = credits.aleo/transfer_public(creator_address, price);
        return (
            ContentAccess {
                owner: self.signer,
                content_id: content_id,
            },
            finalize_buy_content(fut),
        );
    }

    async function finalize_buy_content(f: Future) {
        f.await();
    }

    transition prove_content_access(
        access: ContentAccess,
        public content_id: field,
    ) -> bool {
        assert_eq(access.owner, self.signer);
        assert_eq(access.content_id, content_id);
        return true;
    }

    async transition buy_content_v2(
        public content_id: field,
        public creator_address: address,
        public price: u64,
        public expiry_height: u32,
    ) -> (TimedContentAccess, Future) {
        assert(price > 0u64);
        let purchase_key: field = compute_purchase_key(self.signer, content_id);
        let fut: Future = credits.aleo/transfer_public(creator_address, price);
        return (
            TimedContentAccess {
                owner: self.signer,
                content_id: content_id,
                expiry_height: expiry_height,
            },
            finalize_buy_content_v2(fut, purchase_key, expiry_height),
        );
    }

    async function finalize_buy_content_v2(
        f: Future,
        public purchase_key: field,
        public expiry_height: u32,
    ) {
        let already_purchased: bool = purchased_content.get_or_use(purchase_key, false);
        assert_eq(already_purchased, false);
        assert(expiry_height > block.height);
        f.await();
        purchased_content.set(purchase_key, true);
    }

    async transition prove_content_access_v2(
        access: TimedContentAccess,
        public content_id: field,
    ) -> (bool, TimedContentAccess, Future) {
        assert_eq(access.owner, self.signer);
        assert_eq(access.content_id, content_id);
        return (true, access, finalize_prove_access_v2(access.expiry_height));
    }

    async function finalize_prove_access_v2(public expiry_height: u32) {
        assert(expiry_height > block.height);
    }

    async transition buy_content_usdcx(
        public content_id: field,
        public creator_address: address,
        public price: u128,
        private payment: test_usdcx_stablecoin.aleo/Token,
        private proofs: [test_usdcx_stablecoin.aleo/MerkleProof; 2],
    ) -> (
        ContentAccess,
        test_usdcx_stablecoin.aleo/Token,
        test_usdcx_stablecoin.aleo/Token,
        test_usdcx_stablecoin.aleo/ComplianceRecord,
        Future
    ) {
        let (compliance_record, creator_record, change_record, fut): (
            test_usdcx_stablecoin.aleo/ComplianceRecord,
            test_usdcx_stablecoin.aleo/Token,
            test_usdcx_stablecoin.aleo/Token,
            Future
        ) = test_usdcx_stablecoin.aleo/transfer_private(creator_address, price, payment, proofs);

        return (
            ContentAccess {
                owner: self.signer,
                content_id: content_id,
            },
            creator_record,
            change_record,
            compliance_record,
            finalize_buy_cnt_ucx(fut),
        );
    }

    async function finalize_buy_cnt_ucx(f: Future) {
        f.await();
    }

    async transition buy_content_usdcx_public(
        public content_id: field,
        public creator_address: address,
        public price: u128,
    ) -> (ContentAccess, Future) {
        let fut: Future = test_usdcx_stablecoin.aleo/transfer_public_as_signer(creator_address, price);
        return (
            ContentAccess {
                owner: self.signer,
                content_id: content_id,
            },
            finalize_buy_cnt_ucx_pub(fut),
        );
    }

    async function finalize_buy_cnt_ucx_pub(f: Future) {
        f.await();
    }

    async transition buy_content_usdcx_v2(
        public content_id: field,
        public creator_address: address,
        public price: u128,
        public expiry_height: u32,
        private payment: test_usdcx_stablecoin.aleo/Token,
        private proofs: [test_usdcx_stablecoin.aleo/MerkleProof; 2],
    ) -> (
        TimedContentAccess,
        test_usdcx_stablecoin.aleo/Token,
        test_usdcx_stablecoin.aleo/Token,
        test_usdcx_stablecoin.aleo/ComplianceRecord,
        Future
    ) {
        let purchase_key: field = compute_purchase_key(self.signer, content_id);
        let (compliance_record, creator_record, change_record, fut): (
            test_usdcx_stablecoin.aleo/ComplianceRecord,
            test_usdcx_stablecoin.aleo/Token,
            test_usdcx_stablecoin.aleo/Token,
            Future
        ) = test_usdcx_stablecoin.aleo/transfer_private(creator_address, price, payment, proofs);

        return (
            TimedContentAccess {
                owner: self.signer,
                content_id: content_id,
                expiry_height: expiry_height,
            },
            creator_record,
            change_record,
            compliance_record,
            finalize_buy_cnt_ucx_v2(fut, purchase_key, expiry_height),
        );
    }

    async function finalize_buy_cnt_ucx_v2(
        f: Future,
        public purchase_key: field,
        public expiry_height: u32,
    ) {
        let already_purchased: bool = purchased_content.get_or_use(purchase_key, false);
        assert_eq(already_purchased, false);
        assert(expiry_height > block.height);
        f.await();
        purchased_content.set(purchase_key, true);
    }

    async transition buy_content_usdcx_public_v2(
        public content_id: field,
        public creator_address: address,
        public price: u128,
        public expiry_height: u32,
    ) -> (TimedContentAccess, Future) {
        let purchase_key: field = compute_purchase_key(self.signer, content_id);
        let fut: Future = test_usdcx_stablecoin.aleo/transfer_public_as_signer(creator_address, price);
        return (
            TimedContentAccess {
                owner: self.signer,
                content_id: content_id,
                expiry_height: expiry_height,
            },
            finalize_buy_cnt_ucx_pub_v2(fut, purchase_key, expiry_height),
        );
    }

    async function finalize_buy_cnt_ucx_pub_v2(
        f: Future,
        public purchase_key: field,
        public expiry_height: u32,
    ) {
        let already_purchased: bool = purchased_content.get_or_use(purchase_key, false);
        assert_eq(already_purchased, false);
        assert(expiry_height > block.height);
        f.await();
        purchased_content.set(purchase_key, true);
    }
}
