import credits.aleo;
import test_usdcx_stablecoin.aleo;

// Private access pass with legacy and hardened issuance paths.
program access_pass_v4_xwnxp.aleo {
    @admin(address = "aleo1jvs27kq44uzn8ry5st8mrj6f2cjef93hst7p6ft0rq86gqg8w59q3vw492")
    async constructor() {}

    mapping used_nullifiers: field => bool;

    record AccessPass {
        owner: address,
        creator_id: field,
        content_id: field,
        expiry: field,
        nullifier: field,
    }

    record TimedAccessPass {
        owner: address,
        creator_id: field,
        content_id: field,
        expiry_height: u32,
        nullifier: field,
    }

    // Legacy mint path kept for upgrade compatibility.
    async transition buy_access(
        public creator_id: field,
        public content_id: field,
        public creator_address: address,
        public price: u64,
        public expiry: field,
        public nullifier: field,
    ) -> (AccessPass, Future) {
        assert(price > 0u64);
        let fut: Future = credits.aleo/transfer_public(creator_address, price);
        return (
            AccessPass {
                owner: self.signer,
                creator_id: creator_id,
                content_id: content_id,
                expiry: expiry,
                nullifier: nullifier,
            },
            finalize_buy_access(fut),
        );
    }

    async function finalize_buy_access(f: Future) {
        f.await();
    }

    // Legacy proof path preserved for existing callers.
    transition prove_access(
        pass: AccessPass,
        public creator_id: field,
        public content_id: field,
        public current_height: field,
    ) -> bool {
        assert_eq(pass.owner, self.signer);
        assert_eq(pass.creator_id, creator_id);
        assert_eq(pass.content_id, content_id);
        assert(pass.expiry > current_height);
        return true;
    }

    // Redeem once by revealing the nullifier. Future redemptions are blocked.
    async transition redeem_access(
        pass: AccessPass,
        public current_height: field,
        public nullifier: field,
    ) -> Future {
        assert_eq(pass.owner, self.signer);
        assert_eq(pass.nullifier, nullifier);
        assert(pass.expiry > current_height);
        return finalize_redeem(nullifier);
    }

    async function finalize_redeem(public nullifier: field) {
        let used: bool = used_nullifiers.get_or_use(nullifier, false);
        assert_eq(used, false);
        used_nullifiers.set(nullifier, true);
    }

    async transition buy_access_v2(
        public creator_id: field,
        public content_id: field,
        public creator_address: address,
        public price: u64,
        public expiry_height: u32,
        private nullifier: field,
    ) -> (TimedAccessPass, Future) {
        assert(price > 0u64);
        let fut: Future = credits.aleo/transfer_public(creator_address, price);
        return (
            TimedAccessPass {
                owner: self.signer,
                creator_id: creator_id,
                content_id: content_id,
                expiry_height: expiry_height,
                nullifier: nullifier,
            },
            finalize_buy_access_v2(fut, expiry_height),
        );
    }

    async function finalize_buy_access_v2(f: Future, public expiry_height: u32) {
        assert(expiry_height > block.height);
        f.await();
    }

    async transition buy_access_usdcx(
        public creator_id: field,
        public content_id: field,
        public creator_address: address,
        public price: u128,
        public expiry: field,
        public nullifier: field,
        private payment: test_usdcx_stablecoin.aleo/Token,
        private proofs: [test_usdcx_stablecoin.aleo/MerkleProof; 2],
    ) -> (
        AccessPass,
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
            AccessPass {
                owner: self.signer,
                creator_id: creator_id,
                content_id: content_id,
                expiry: expiry,
                nullifier: nullifier,
            },
            creator_record,
            change_record,
            compliance_record,
            finalize_buy_acc_ucx(fut),
        );
    }

    async function finalize_buy_acc_ucx(f: Future) {
        f.await();
    }

    async transition buy_access_usdcx_public(
        public creator_id: field,
        public content_id: field,
        public creator_address: address,
        public price: u128,
        public expiry: field,
        public nullifier: field,
    ) -> (AccessPass, Future) {
        let fut: Future = test_usdcx_stablecoin.aleo/transfer_public_as_signer(creator_address, price);
        return (
            AccessPass {
                owner: self.signer,
                creator_id: creator_id,
                content_id: content_id,
                expiry: expiry,
                nullifier: nullifier,
            },
            finalize_buy_acc_ucx_pub(fut),
        );
    }

    async function finalize_buy_acc_ucx_pub(f: Future) {
        f.await();
    }

    async transition prove_access_v2(
        pass: TimedAccessPass,
        public creator_id: field,
        public content_id: field,
    ) -> (bool, TimedAccessPass, Future) {
        assert_eq(pass.owner, self.signer);
        assert_eq(pass.creator_id, creator_id);
        assert_eq(pass.content_id, content_id);
        return (true, pass, finalize_prove_access_v2(pass.expiry_height));
    }

    async function finalize_prove_access_v2(public expiry_height: u32) {
        assert(expiry_height > block.height);
    }

    async transition buy_access_usdcx_v2(
        public creator_id: field,
        public content_id: field,
        public creator_address: address,
        public price: u128,
        public expiry_height: u32,
        private nullifier: field,
        private payment: test_usdcx_stablecoin.aleo/Token,
        private proofs: [test_usdcx_stablecoin.aleo/MerkleProof; 2],
    ) -> (
        TimedAccessPass,
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
            TimedAccessPass {
                owner: self.signer,
                creator_id: creator_id,
                content_id: content_id,
                expiry_height: expiry_height,
                nullifier: nullifier,
            },
            creator_record,
            change_record,
            compliance_record,
            finalize_buy_acc_ucx_v2(fut, expiry_height),
        );
    }

    async function finalize_buy_acc_ucx_v2(f: Future, public expiry_height: u32) {
        assert(expiry_height > block.height);
        f.await();
    }

    async transition buy_access_usdcx_public_v2(
        public creator_id: field,
        public content_id: field,
        public creator_address: address,
        public price: u128,
        public expiry_height: u32,
        private nullifier: field,
    ) -> (TimedAccessPass, Future) {
        let fut: Future = test_usdcx_stablecoin.aleo/transfer_public_as_signer(creator_address, price);
        return (
            TimedAccessPass {
                owner: self.signer,
                creator_id: creator_id,
                content_id: content_id,
                expiry_height: expiry_height,
                nullifier: nullifier,
            },
            finalize_buy_acc_ucx_pub_v2(fut, expiry_height),
        );
    }

    async function finalize_buy_acc_ucx_pub_v2(f: Future, public expiry_height: u32) {
        assert(expiry_height > block.height);
        f.await();
    }

    async transition redeem_access_v2(pass: TimedAccessPass) -> Future {
        assert_eq(pass.owner, self.signer);
        return finalize_redeem_v2(pass.nullifier, pass.expiry_height);
    }

    async function finalize_redeem_v2(public nullifier: field, public expiry_height: u32) {
        assert(expiry_height > block.height);
        let used: bool = used_nullifiers.get_or_use(nullifier, false);
        assert_eq(used, false);
        used_nullifiers.set(nullifier, true);
    }
}
